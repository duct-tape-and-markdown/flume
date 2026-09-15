/**
 * The mechanical form of the absence verdict `.claude/rules/engineering.md`
 * *An export earns its consumer* describes: an export is residue when the
 * package's `exports` map cannot reach it **and** no module outside its own
 * references it.
 *
 * References resolve through the TypeScript compiler API, never text. That is
 * the bullet's own bar — an absence verdict never rests on a bare text search
 * — and it is what makes the two halves honest: a namespace import plus
 * property access resolves to the same symbol a named import does, while a
 * name appearing only in a doc comment is not an AST node and counts for
 * nothing.
 *
 * Not *.test.ts, so neither vitest lane collects it as a suite of its own.
 */

import { readFileSync } from "node:fs";
import { join, relative, resolve } from "node:path";

import ts from "typescript";

/**
 * The two config files a scan is drawn from, and the manifest whose `exports`
 * map supplies the roots. Every one is the artifact the real toolchain reads,
 * so a scan can never judge a surface the build does not actually ship.
 */
export interface ExportScanRequest {
  /** Absolute path to the package root — the directory holding the manifest. */
  readonly root: string;
  /**
   * The tsconfig whose file list *is* the shipped surface. Its `outDir` and
   * `rootDir` also fold the manifest's emitted `exports` targets back to the
   * sources they are built from, so a third entry added to the map joins the
   * roots with no edit here.
   */
  readonly buildConfig: string;
  /**
   * The tsconfig covering every module that may consume the shipped surface —
   * the sources, the tests, the example chains. A consumer outside this list
   * is invisible to the scan, so it is the widest config the repo has.
   */
  readonly programConfig: string;
  /** Manifest filename, relative to `root`. */
  readonly manifest?: string;
}

/** One exported symbol of one shipped module. */
export interface ExportSite {
  /** Module path, relative to `root` and in posix form. */
  readonly module: string;
  readonly name: string;
  /** 1-based line of the symbol's declaration. */
  readonly line: number;
}

export interface ExportScan {
  /** The shipped modules the manifest's `exports` map names, relative to `root`. */
  readonly entryModules: readonly string[];
  /** Every export of every shipped module — the judged set. */
  readonly scanned: readonly ExportSite[];
  /** Judged exports the `exports` map reaches, directly or through a type chain. */
  readonly reachable: readonly ExportSite[];
  /** Judged exports the map cannot reach, but some other module references. */
  readonly referenced: readonly ExportSite[];
  /** Judged exports neither reachable nor referenced — the residue. */
  readonly unearned: readonly ExportSite[];
  /**
   * Every function signature the `exports` map reaches — one half of the set
   * `unnamable` is judged over, so a walk that stopped finding functions is
   * visible rather than reading as a clean verdict.
   */
  readonly signatures: readonly ExportSite[];
  /**
   * Every non-function property position the `exports` map reaches — the
   * other half of that set, carrying the same guard.
   */
  readonly properties: readonly ExportSite[];
  /**
   * Types a consumer can read but cannot name: a type the shipped surface's
   * signature and property positions mention, declared in the shipped tree,
   * that no entry module exports under any name.
   */
  readonly unnamable: readonly UnnamableType[];
}

/**
 * Which position named the type. A signature names one in a parameter or a
 * return annotation, a property in its own annotation; the two are found by
 * different halves of the walk, so either can be judged alone.
 */
export type PositionKind = "signature" | "property";

/** One reached position naming a type the `exports` map cannot hand out. */
export interface UnnamableType {
  /** The signature or property whose annotation names it. */
  readonly position: ExportSite;
  readonly kind: PositionKind;
  /** Where the unnamable type is declared. */
  readonly type: ExportSite;
}

const parseConfig = (path: string): ts.ParsedCommandLine => {
  const host: ts.ParseConfigFileHost = {
    ...ts.sys,
    onUnRecoverableConfigFileDiagnostic: (d) => {
      throw new Error(
        `${path}: ${ts.flattenDiagnosticMessageText(d.messageText, " ")}`,
      );
    },
  };
  const parsed = ts.getParsedCommandLineOfConfigFile(path, {}, host);
  if (!parsed) {
    throw new Error(`no tsconfig at ${path}`);
  }
  return parsed;
};

/**
 * Every string leaf of a conditional-`exports` subtree. Conditions nest
 * arbitrarily (`types`/`import`/`default`, and the sugar form where the value
 * is a bare string), and each leaf is an emitted artifact this scan folds back
 * to a source.
 */
const exportTargets = (node: unknown): string[] => {
  if (typeof node === "string") {
    return [node];
  }
  if (node === null || typeof node !== "object") {
    return [];
  }
  return Object.values(node as Record<string, unknown>).flatMap(exportTargets);
};

/** Repo-relative, posix-separated — the alphabet every reported path uses. */
const relPath = (root: string, path: string): string =>
  relative(root, path).split(/[\\/]/).join("/");

/**
 * The declaration a symbol's site is reported from. An alias resolves to what
 * it aliases first, so a re-exported name is reported at the module that
 * declares it rather than at the barrel that forwards it.
 */
const siteOf = (
  root: string,
  sym: ts.Symbol,
  fallbackModule: string,
): ExportSite => {
  const decl = sym.declarations?.[0];
  if (!decl) {
    return { module: fallbackModule, name: sym.getName(), line: 0 };
  }
  const file = decl.getSourceFile();
  return {
    module: relPath(root, file.fileName),
    name: sym.getName(),
    line: file.getLineAndCharacterOfPosition(decl.getStart()).line + 1,
  };
};

/**
 * A `private` member or one named by a `#name`. TypeScript emits neither's
 * type into the `.d.ts` — a private property declaration loses its
 * annotation entirely — so neither walk below treats one as public surface.
 */
const isPrivateMember = (node: ts.Node): boolean => {
  if (!ts.isClassElement(node) && !ts.isTypeElement(node)) return false;
  if (node.name !== undefined && ts.isPrivateIdentifier(node.name)) return true;
  return (
    ts.canHaveModifiers(node) &&
    (ts.getModifiers(node) ?? []).some(
      (m) => m.kind === ts.SyntaxKind.PrivateKeyword,
    )
  );
};

/**
 * Whether a declaration sits inside a `namespace` body. Such a type is named
 * through its namespace (`StandardSchemaV1.Result`), never through an import
 * specifier of its own, so the nameability verdict has nothing to say about
 * it.
 */
const inNamespace = (decl: ts.Node): boolean => {
  for (let n: ts.Node | undefined = decl.parent; n; n = n.parent) {
    if (ts.isModuleDeclaration(n)) return true;
    if (ts.isSourceFile(n)) return false;
  }
  return false;
};

/** `module:line name`, the form a failure message cites a finding in. */
export const formatSite = (site: ExportSite): string =>
  `${site.module}:${site.line} ${site.name}`;
/** `<position> names <type>`, the form a failure message cites a finding in. */
export const formatUnnamableType = (found: UnnamableType): string =>
  `${formatSite(found.position)} names ${formatSite(found.type)}`;

/**
 * Scan a package's shipped modules for exports nothing earns.
 *
 * Reachability starts at the `exports` map's entry modules and expands through
 * **type positions only** — a type reference, a `typeof` query, an `import()`
 * type, a heritage clause — descending into namespace and interface members.
 * That is the graph the emitted `.d.ts` files actually expose, which is why
 * function bodies are skipped: a module-local helper a public method happens to
 * call is not public surface, and counting it would let the scan earn exports
 * on evidence a consumer can never see.
 *
 * The same walk carries a second, stricter verdict alongside it. Reachability
 * asks whether a consumer can *read* a type; `unnamable` asks whether one can
 * *write* it — a type named by a signature or a property position is nameable
 * only when some entry module exports it under a name an import specifier can
 * carry.
 */
export const scanExports = (request: ExportScanRequest): ExportScan => {
  const root = resolve(request.root);
  const build = parseConfig(join(root, request.buildConfig));
  const domain = parseConfig(join(root, request.programConfig));
  const program = ts.createProgram({
    rootNames: domain.fileNames,
    options: domain.options,
  });
  const checker = program.getTypeChecker();

  const { outDir, rootDir } = build.options;
  if (outDir === undefined || rootDir === undefined) {
    throw new Error(
      `${request.buildConfig} must state both outDir and rootDir: the exports map's emitted targets fold back to sources through them`,
    );
  }

  const manifest = JSON.parse(
    readFileSync(join(root, request.manifest ?? "package.json"), "utf8"),
  ) as { readonly exports?: unknown };

  /**
   * An emitted target folded back to the source it is built from. `outDir` and
   * `rootDir` are already absolute here (the config parser resolves them), so
   * the fold is the same one `tsc` performed in the other direction.
   */
  const entryFiles = new Set(
    exportTargets(manifest.exports).map((target) =>
      resolve(rootDir, relative(outDir, resolve(root, target))).replace(
        /\.d\.ts$|\.js$/,
        ".ts",
      ),
    ),
  );

  const sourceFileAt = (path: string): ts.SourceFile => {
    const sf = program.getSourceFile(path);
    if (!sf) {
      throw new Error(
        `${relPath(root, path)} is not in the program ${request.programConfig} describes`,
      );
    }
    return sf;
  };

  const unalias = (sym: ts.Symbol): ts.Symbol =>
    sym.flags & ts.SymbolFlags.Alias ? checker.getAliasedSymbol(sym) : sym;

  const moduleExports = (path: string): readonly ts.Symbol[] => {
    const modSym = checker.getSymbolAtLocation(sourceFileAt(path));
    return modSym ? checker.getExportsOfModule(modSym) : [];
  };

  // --- reachable from the exports map ------------------------------------
  const reachable = new Set<ts.Symbol>();
  const frontier: ts.Symbol[] = [];
  const reach = (sym: ts.Symbol | undefined): void => {
    if (!sym) return;
    const target = unalias(sym);
    if (reachable.has(target)) return;
    reachable.add(target);
    frontier.push(target);
  };

  for (const entry of entryFiles) {
    for (const sym of moduleExports(entry)) reach(sym);
  }

  for (let sym = frontier.pop(); sym !== undefined; sym = frontier.pop()) {
    for (const decl of sym.declarations ?? []) {
      // A module symbol on the frontier is an `export * as ns` — the whole
      // module is public under a name, so every one of its exports is reached.
      if (ts.isSourceFile(decl)) {
        for (const nested of checker.getExportsOfModule(sym)) reach(nested);
        continue;
      }
      const visit = (node: ts.Node): void => {
        // Neither a body nor a private member is public surface — neither
        // reaches a `.d.ts` in a form a consumer can read.
        if (ts.isBlock(node) || isPrivateMember(node)) return;
        if (ts.isTypeReferenceNode(node)) {
          reach(checker.getSymbolAtLocation(node.typeName));
        } else if (ts.isTypeQueryNode(node)) {
          reach(checker.getSymbolAtLocation(node.exprName));
        } else if (ts.isImportTypeNode(node) && node.qualifier) {
          reach(checker.getSymbolAtLocation(node.qualifier));
        } else if (ts.isExpressionWithTypeArguments(node)) {
          reach(checker.getSymbolAtLocation(node.expression));
        }
        ts.forEachChild(node, visit);
      };
      ts.forEachChild(decl, visit);
    }
  }

  // --- types the exports map reaches but cannot hand out ------------------
  // Reachability above proves a type is *readable*: it lands in the emitted
  // `.d.ts` and hover text shows it. It does not prove the type is
  // *nameable* — a consumer writing `const o: RenderOptions = …` needs an
  // import specifier, and only an entry module's own export list supplies
  // one. So this arm re-asks the stricter question over the positions the map
  // reaches: every type one of them names, declared in the shipped tree, must
  // be exported by some entry module.
  //
  // A position is an annotation a consumer reads but may not be able to
  // write — a function's parameters and return, and a property's own type.
  // Scope is every position a reached symbol carries into the `.d.ts`: the
  // reached function or variable itself, and the members of a reached type.
  // `Chain.worktreesBase` names a parameter type and `FlumeApi.paths` a
  // property type, each of which a chain author must be able to annotate
  // exactly as `renderPrompt`'s parameter demands.
  //
  // Three exclusions, each for the reason the verdict exists. A `private`
  // member carries no annotation into the `.d.ts` at all. A namespace member
  // is named through its namespace rather than through an import specifier.
  // And a type alias's own type node is a *second name* for what it points
  // at rather than a position naming it — importing the alias imports the
  // type — so the walk descends through one without reporting it.
  const entryExported = new Set<ts.Symbol>();
  for (const entry of entryFiles) {
    for (const sym of moduleExports(entry)) entryExported.add(unalias(sym));
  }
  const shippedFiles = new Set(build.fileNames.map((f) => resolve(f)));

  /**
   * One position the walk found, under the name a consumer reads it by —
   * dotted from the reached symbol: `renderPrompt`, `Chain.worktreesBase`. A
   * signature carries its declaration, whose parameter and return annotations
   * are walked; a property carries its annotation directly.
   */
  type FoundPosition =
    | {
        readonly kind: "signature";
        readonly node: ts.SignatureDeclaration;
        readonly name: string;
      }
    | {
        readonly kind: "property";
        readonly node: ts.TypeNode;
        readonly name: string;
      };

  /**
   * How a consumer addresses one member of a container. A call, construct or
   * index signature has no name of its own — it is written by writing the
   * container — so it is reported by its kind.
   */
  const memberPath = (
    member: ts.ClassElement | ts.TypeElement,
    prefix: string,
  ): string => {
    if (member.name) return `${prefix}.${member.name.getText()}`;
    if (ts.isConstructSignatureDeclaration(member)) return `${prefix}.<new>`;
    if (ts.isIndexSignatureDeclaration(member)) return `${prefix}.<index>`;
    return `${prefix}.<call>`;
  };

  /**
   * The positions an annotation carries: a signature when it is a function
   * type, its members' when it is an object type, and otherwise the
   * annotation itself. A function type's own parameters are not descended
   * into — the type walk below already reads every type reference nested
   * inside one.
   */
  const fromAnnotation = (
    type: ts.TypeNode,
    name: string,
    out: FoundPosition[],
    /**
     * Whether the annotation is a position in its own right. False for a type
     * alias's right-hand side, which *is* the name it was reached under.
     */
    reportsItself = true,
  ): void => {
    if (ts.isFunctionLike(type)) {
      out.push({ kind: "signature", node: type, name });
    } else if (ts.isTypeLiteralNode(type)) {
      fromMembers(type.members, name, out);
    } else if (reportsItself) {
      out.push({ kind: "property", node: type, name });
    }
  };

  function fromMembers(
    members: readonly (ts.ClassElement | ts.TypeElement)[],
    prefix: string,
    out: FoundPosition[],
  ): void {
    for (const member of members) {
      if (isPrivateMember(member)) continue;
      const name = memberPath(member, prefix);
      if (ts.isFunctionLike(member)) {
        out.push({ kind: "signature", node: member, name });
      } else if (
        (ts.isPropertySignature(member) || ts.isPropertyDeclaration(member)) &&
        member.type
      ) {
        fromAnnotation(member.type, name, out);
      }
    }
  }

  /**
   * Every position one reached declaration carries. A `function` statement is
   * a signature; so is `const f = (…) => …`, while any other annotation a
   * `const` carries is a property position. An interface or a class carries
   * its members' positions instead of one of its own, and so does a type
   * alias — except that the alias's own type node is descended into rather
   * than reported, being the name it was reached under. A namespace and an
   * enum carry none the map hands out by name.
   */
  const positionsOf = (
    decl: ts.Declaration,
    name: string,
  ): readonly FoundPosition[] => {
    const out: FoundPosition[] = [];
    if (ts.isFunctionLike(decl)) {
      out.push({ kind: "signature", node: decl, name });
    } else if (ts.isVariableDeclaration(decl)) {
      if (decl.type) fromAnnotation(decl.type, name, out);
      if (
        out.length === 0 &&
        decl.initializer &&
        ts.isFunctionLike(decl.initializer)
      ) {
        out.push({ kind: "signature", node: decl.initializer, name });
      }
    } else if (ts.isInterfaceDeclaration(decl) || ts.isClassDeclaration(decl)) {
      fromMembers(decl.members, name, out);
    } else if (ts.isTypeAliasDeclaration(decl)) {
      fromAnnotation(decl.type, name, out, /* reportsItself */ false);
    }
    return out;
  };

  const signatures: ExportSite[] = [];
  const properties: ExportSite[] = [];
  const unnamable: UnnamableType[] = [];
  const reported = new Set<string>();

  for (const owner of reachable) {
    for (const decl of owner.declarations ?? []) {
      if (ts.isSourceFile(decl)) continue;
      const file = decl.getSourceFile();
      if (!shippedFiles.has(resolve(file.fileName))) continue;
      if (inNamespace(decl)) continue;

      for (const found of positionsOf(decl, owner.getName())) {
        const position: ExportSite = {
          module: relPath(root, file.fileName),
          name: found.name,
          line:
            file.getLineAndCharacterOfPosition(found.node.getStart()).line + 1,
        };
        (found.kind === "signature" ? signatures : properties).push(position);

        const named = (node: ts.Node): void => {
          if (ts.isTypeReferenceNode(node)) {
            const sym = checker.getSymbolAtLocation(node.typeName);
            const target = sym ? unalias(sym) : undefined;
            // Where the named type is declared in the shipped tree. A type
            // declared nowhere the package ships is the consumer's own or the
            // lib's, and nameable already.
            const shipped = (target?.declarations ?? []).filter((d) =>
              shippedFiles.has(resolve(d.getSourceFile().fileName)),
            );
            // A type parameter is declared by this position's own scope and
            // named by writing it; a namespace member is named through its
            // namespace. Neither is reached by an import specifier, so the
            // verdict has nothing to say about either.
            if (
              target &&
              !(target.flags & ts.SymbolFlags.TypeParameter) &&
              !entryExported.has(target) &&
              shipped.length > 0 &&
              !shipped.some(inNamespace)
            ) {
              const finding: UnnamableType = {
                position,
                kind: found.kind,
                type: siteOf(root, target, position.module),
              };
              const key = formatUnnamableType(finding);
              if (!reported.has(key)) {
                reported.add(key);
                unnamable.push(finding);
              }
            }
          }
          ts.forEachChild(node, named);
        };

        if (found.kind === "property") {
          named(found.node);
        } else {
          for (const param of found.node.parameters) {
            if (param.type) named(param.type);
          }
          if (found.node.type) named(found.node.type);
        }
      }
    }
  }

  // --- referenced from some other module ---------------------------------
  // One pass over every non-declaration source: each identifier that resolves
  // to a symbol records the file it was read from. A namespace import's
  // property access resolves to the same symbol a named import does; a name
  // that appears only inside a comment is no node at all and records nothing.
  const referencedFrom = new Map<ts.Symbol, Set<string>>();
  for (const sf of program.getSourceFiles()) {
    if (sf.isDeclarationFile) continue;
    const from = resolve(sf.fileName);
    const visit = (node: ts.Node): void => {
      if (ts.isIdentifier(node)) {
        const sym = checker.getSymbolAtLocation(node);
        if (sym) {
          const target = unalias(sym);
          let files = referencedFrom.get(target);
          if (!files) {
            files = new Set<string>();
            referencedFrom.set(target, files);
          }
          files.add(from);
        }
      }
      ts.forEachChild(node, visit);
    };
    ts.forEachChild(sf, visit);
  }

  // --- judge every export of every shipped module -------------------------
  const scanned: ExportSite[] = [];
  const reachedSites: ExportSite[] = [];
  const referencedSites: ExportSite[] = [];
  const unearned: ExportSite[] = [];

  for (const path of build.fileNames.map((f) => resolve(f))) {
    const module = relPath(root, path);
    for (const exported of moduleExports(path)) {
      const sym = unalias(exported);
      // A barrel forwarding someone else's symbol is not declaring an export
      // of its own; the declaring module is where that one is judged.
      if (!sym.declarations?.some((d) => resolve(d.getSourceFile().fileName) === path)) {
        continue;
      }
      const site = siteOf(root, sym, module);
      scanned.push(site);
      if (reachable.has(sym)) {
        reachedSites.push(site);
      } else if (
        [...(referencedFrom.get(sym) ?? [])].some((file) => file !== path)
      ) {
        referencedSites.push(site);
      } else {
        unearned.push(site);
      }
    }
  }

  return {
    entryModules: [...entryFiles].map((f) => relPath(root, f)),
    scanned,
    reachable: reachedSites,
    referenced: referencedSites,
    unearned,
    signatures,
    properties,
    unnamable,
  };
};
