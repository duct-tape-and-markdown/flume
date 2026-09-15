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
   * Every function signature the `exports` map reaches — the set `unnamable`
   * is judged over, so a walk that stopped finding functions is visible
   * rather than reading as a clean verdict.
   */
  readonly signatures: readonly ExportSite[];
  /**
   * Signature types a consumer can read but cannot name: a type the shipped
   * surface's parameter and return positions mention, declared in the shipped
   * tree, that no entry module exports under any name.
   */
  readonly unnamable: readonly SignatureType[];
}

/** One signature position naming a type the `exports` map cannot hand out. */
export interface SignatureType {
  /** The function-like declaration whose signature names it. */
  readonly signature: ExportSite;
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

/** `module:line name`, the form a failure message cites a finding in. */
export const formatSite = (site: ExportSite): string =>
  `${site.module}:${site.line} ${site.name}`;
/** `<signature> names <type>`, the form a failure message cites a finding in. */
export const formatSignatureType = (found: SignatureType): string =>
  `${formatSite(found.signature)} names ${formatSite(found.type)}`;

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
 * *write* it — a signature type is nameable only when some entry module
 * exports it under a name an import specifier can carry.
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
        // A body is not public surface — it never reaches a `.d.ts`.
        if (ts.isBlock(node)) return;
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

  // --- signature types the exports map cannot hand out --------------------
  // Reachability above proves a type is *readable*: it lands in the emitted
  // `.d.ts` and hover text shows it. It does not prove the type is
  // *nameable* — a consumer writing `const o: RenderOptions = …` needs an
  // import specifier, and only an entry module's own export list supplies
  // one. So this arm re-asks the stricter question over the signatures the
  // map reaches: every type a parameter or return position names, declared
  // in the shipped tree, must be exported by some entry module.
  //
  // Scope is the reached *function* — a top-level declaration whose own
  // symbol the map reaches. A member signature inside a reached type is not
  // one: a private method carries no signature into the `.d.ts` at all, and
  // a namespace member is named through its namespace rather than imported.
  const entryExported = new Set<ts.Symbol>();
  for (const entry of entryFiles) {
    for (const sym of moduleExports(entry)) entryExported.add(unalias(sym));
  }
  const shippedFiles = new Set(build.fileNames.map((f) => resolve(f)));

  /**
   * The signature a declaration carries, if it is a function at all. A
   * `function` statement is one; so is `const f = (…) => …` and the
   * function-type annotation a `const` may carry instead of an initializer.
   */
  const signatureOf = (
    decl: ts.Declaration,
  ): ts.SignatureDeclaration | undefined => {
    if (ts.isFunctionLike(decl)) return decl;
    if (ts.isVariableDeclaration(decl)) {
      if (decl.type && ts.isFunctionLike(decl.type)) return decl.type;
      if (decl.initializer && ts.isFunctionLike(decl.initializer)) {
        return decl.initializer;
      }
    }
    return undefined;
  };

  const signatures: ExportSite[] = [];
  const unnamable: SignatureType[] = [];
  const reported = new Set<string>();

  for (const owner of reachable) {
    for (const decl of owner.declarations ?? []) {
      if (ts.isSourceFile(decl)) continue;
      const file = decl.getSourceFile();
      if (!shippedFiles.has(resolve(file.fileName))) continue;
      const fn = signatureOf(decl);
      if (!fn) continue;

      const signature: ExportSite = {
        module: relPath(root, file.fileName),
        name: owner.getName(),
        line: file.getLineAndCharacterOfPosition(decl.getStart()).line + 1,
      };
      signatures.push(signature);

      const named = (node: ts.Node): void => {
        if (ts.isTypeReferenceNode(node)) {
          const sym = checker.getSymbolAtLocation(node.typeName);
          const target = sym ? unalias(sym) : undefined;
          // A type parameter is declared by this signature and named by
          // writing the signature, never by importing it.
          if (
            target &&
            !(target.flags & ts.SymbolFlags.TypeParameter) &&
            !entryExported.has(target) &&
            (target.declarations ?? []).some((d) =>
              shippedFiles.has(resolve(d.getSourceFile().fileName)),
            )
          ) {
            const found: SignatureType = {
              signature,
              type: siteOf(root, target, signature.module),
            };
            const key = formatSignatureType(found);
            if (!reported.has(key)) {
              reported.add(key);
              unnamable.push(found);
            }
          }
        }
        ts.forEachChild(node, named);
      };

      for (const param of fn.parameters) {
        if (param.type) named(param.type);
      }
      if (fn.type) named(fn.type);
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
    unnamable,
  };
};
