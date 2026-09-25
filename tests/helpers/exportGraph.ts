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
 * The shipped surface is read from the **declaration emit** the build config
 * produces, not from the sources it is built from
 * (`.claude/rules/engineering.md`, *A seam gate reads what the real writer
 * wrote*): `tsc` is the writer of what a consumer imports, and a source
 * annotation is at best a partial transcript of it. A `const` whose type is
 * inferred carries no annotation to walk yet ships a full type, so reading the
 * source drops it silently. This scan runs the real declaration emit in memory
 * and walks its output.
 *
 * Two alphabets meet here, and each site says which it is in. A **position**
 * — and the type it names — is cited in the emit (`dist/src/….d.ts`), because
 * an inferred annotation has a line there and nowhere else. Everything a
 * reader acts on by module — the entry modules, the judged exports, the
 * residue — is folded back and cited in the sources, because that is where an
 * export is deleted and where the consumers that earn one live.
 *
 * Not *.test.ts, so neither vitest lane collects it as a suite of its own.
 */

import { readFileSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";

import ts from "typescript";

import {
  eachToken,
  parseConfig,
  relPath,
  repoProgram,
  sourcesOf,
  type ProgramScanRequest,
  type Scan,
  type ScanSite,
} from "./repoProgram.ts";

/**
 * The two config files a scan is drawn from, and the manifest whose `exports`
 * map supplies the roots. Every one is the artifact the real toolchain reads,
 * so a scan can never judge a surface the build does not actually ship.
 */
export interface ExportScanRequest extends ProgramScanRequest {
  /**
   * The tsconfig whose file list *is* the shipped surface. The scan runs its
   * declaration emit, so the walk reads what a consumer imports. Its `outDir`
   * and `rootDir` fold each emitted declaration back to the source it is built
   * from, which is how the export verdicts below reach source coordinates.
   */
  readonly buildConfig: string;
  /** Manifest filename, relative to the request's root. */
  readonly manifest?: string;
}

/**
 * One exported symbol of one shipped module, or one position it carries. Its
 * module is an emitted declaration for the shipped-surface sites and a source
 * for the export verdicts, per the two alphabets above.
 */
export interface ExportSite extends ScanSite {
  readonly name: string;
}

/**
 * Which position named the type. A signature names one in a parameter or a
 * return annotation, a property in its own annotation; the two are found by
 * different halves of the walk, so either can be judged alone.
 */
export type PositionKind = "signature" | "property";

/**
 * One position of the shipped surface the `exports` map reaches, carrying
 * which half of the walk found it — so a walk that stopped finding functions,
 * or properties, is visible rather than reading as a clean verdict.
 */
export interface ExportPosition extends ExportSite {
  readonly kind: PositionKind;
}

/** One reached position naming a type the `exports` map cannot hand out. */
export interface UnnamableType {
  /** The signature or property whose annotation names it. */
  readonly position: ExportSite;
  readonly kind: PositionKind;
  /** Where the unnamable type is declared. */
  readonly type: ExportSite;
}

/**
 * Two verdicts over two judged sets. The scan's own is the rule's: every
 * export of every shipped module is `scanned`, and the residue neither
 * reachable nor referenced is `findings`. `positions` carries the second — a
 * different judged set, so a `Scan` of its own.
 */
export interface ExportScan extends Scan<ExportSite> {
  /**
   * The shipped modules the manifest's `exports` map names, relative to the
   * request's root. The map names each as an emitted declaration; this is
   * that target folded back to the source it is built from.
   */
  readonly entryModules: readonly string[];
  /** Judged exports the `exports` map reaches, directly or through a type chain. */
  readonly reachable: readonly ExportSite[];
  /** Judged exports the map cannot reach, but some other module references. */
  readonly referenced: readonly ExportSite[];
  /**
   * The positions the `exports` map reaches, and among them the ones naming a
   * type a consumer can read but cannot name: a type declared in the shipped
   * tree that no entry module exports under any name.
   */
  readonly positions: Scan<ExportPosition, UnnamableType>;
}

/**
 * The build config's declaration emit, run for real and kept in memory: every
 * emitted `.d.ts` by absolute path. Nothing reaches disk — the `dist/` that
 * `pnpm build` leaves behind is not this scan's to create or to clobber.
 *
 * A skipped or diagnosed emit throws rather than yielding a short map: a scan
 * over a partial surface would report every absence verdict green for having
 * read nothing (`.claude/rules/engineering.md`, *Loud or nothing*).
 */
const emitDeclarations = (
  build: ts.ParsedCommandLine,
  configPath: string,
): ReadonlyMap<string, string> => {
  const program = ts.createProgram({
    rootNames: build.fileNames,
    options: {
      ...build.options,
      noEmit: false,
      declaration: true,
      emitDeclarationOnly: true,
      // The build writes these beside the emit for an editor to follow back;
      // the scan reads the declarations themselves, so they are noise here.
      declarationMap: false,
      sourceMap: false,
      inlineSourceMap: false,
      inlineSources: false,
    },
  });
  const emitted = new Map<string, string>();
  const result = program.emit(
    undefined,
    (fileName, text) => {
      emitted.set(resolve(fileName), text);
    },
    undefined,
    /* emitOnlyDtsFiles */ true,
  );
  const errors = result.diagnostics.filter(
    (d) => d.category === ts.DiagnosticCategory.Error,
  );
  if (result.emitSkipped || errors.length > 0) {
    const detail =
      errors
        .map((d) => ts.flattenDiagnosticMessageText(d.messageText, " "))
        .join("; ") || "emit skipped";
    throw new Error(`${configPath}: declaration emit failed — ${detail}`);
  }
  if (emitted.size === 0) {
    throw new Error(`${configPath}: declaration emit produced no declarations`);
  }
  return emitted;
};

/**
 * A program over the emitted declarations, served from memory. The emit's
 * relative specifiers (`./Agent.js`) resolve against the `outDir` layout a
 * published consumer resolves them in, and whatever the emit reaches outside
 * it — `lib`, `node_modules` — comes off disk through the base host.
 *
 * The `outDir` tree exists only in that map, so the host answers for its
 * directories as well as its files (`.claude/rules/platform-facts.md`,
 * *TypeScript abandons a module lookup whose directory the host denies*).
 */
const declarationProgram = (
  emitted: ReadonlyMap<string, string>,
  options: ts.CompilerOptions,
): ts.Program => {
  const opts: ts.CompilerOptions = {
    ...options,
    noEmit: true,
    declaration: false,
    declarationMap: false,
    emitDeclarationOnly: false,
    sourceMap: false,
    allowImportingTsExtensions: false,
  };
  const dirs = new Set<string>();
  for (const file of emitted.keys()) {
    for (let dir = dirname(file); !dirs.has(dir); dir = dirname(dir)) {
      dirs.add(dir);
      if (dir === dirname(dir)) break;
    }
  }
  const base = ts.createCompilerHost(opts, true);
  const host: ts.CompilerHost = {
    ...base,
    fileExists: (fileName) =>
      emitted.has(resolve(fileName)) || base.fileExists(fileName),
    readFile: (fileName) =>
      emitted.get(resolve(fileName)) ?? base.readFile(fileName),
    directoryExists: (directoryName) =>
      dirs.has(resolve(directoryName)) ||
      (base.directoryExists?.(directoryName) ?? false),
    getSourceFile: (fileName, languageVersion, onError, shouldCreate) => {
      const text = emitted.get(resolve(fileName));
      return text === undefined
        ? base.getSourceFile(fileName, languageVersion, onError, shouldCreate)
        : ts.createSourceFile(fileName, text, languageVersion, true);
    },
  };
  return ts.createProgram({
    rootNames: [...emitted.keys()],
    options: opts,
    host,
  });
};

/**
 * Every string leaf of a conditional-`exports` subtree. Conditions nest
 * arbitrarily (`types`/`import`/`default`, and the sugar form where the value
 * is a bare string), and each leaf names an emitted artifact this scan holds.
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

/** Resolve an alias — a re-export — to the symbol it forwards. */
const unalias = (checker: ts.TypeChecker, sym: ts.Symbol): ts.Symbol =>
  sym.flags & ts.SymbolFlags.Alias ? checker.getAliasedSymbol(sym) : sym;

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
 * A `private` member or one named by a `#name`. The emit keeps a private
 * property's name and drops its type entirely, so neither walk below treats
 * one as public surface.
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
 * The shipped surface itself: the declaration emit, the entry declarations the
 * `exports` map names, and every symbol reachable from them.
 *
 * One walk, two readers. The export verdict below asks which exports it did
 * *not* reach; `packageSurface` asks what it did — and a second traversal
 * spelled beside this one would be the same steps returning differently
 * (`.claude/rules/engineering.md`, *A module is one job*).
 */
interface ShippedSurface {
  /** The request's root, resolved absolute. */
  readonly root: string;
  /** The build config, parsed — its file list is the shipped tree. */
  readonly build: ts.ParsedCommandLine;
  /** Every emitted declaration, by absolute path. */
  readonly emitted: ReadonlyMap<string, string>;
  /** The program over that emit, and the checker resolving it. */
  readonly emit: ts.Program;
  readonly emitChecker: ts.TypeChecker;
  /** The `exports` map's declaration targets — the roots of the walk. */
  readonly entryFiles: ReadonlySet<string>;
  /** What those roots export under a name an import specifier can carry. */
  readonly entryExported: ReadonlySet<ts.Symbol>;
  /** Every symbol the walk reached, through type positions alone. */
  readonly reachable: ReadonlySet<ts.Symbol>;
  /** One emitted declaration folded back to the source it is built from. */
  sourceOf(emittedPath: string): string;
}

/**
 * Run the declaration emit and reach every symbol the `exports` map exposes.
 *
 * Reachability starts at the map's entry declarations and expands through
 * **type positions only** — a type reference, a `typeof` query, an `import()`
 * type, a heritage clause — descending into namespace and interface members.
 * Over the emit that restriction costs nothing: a `.d.ts` holds no function
 * bodies to skip, so what the walk sees is what a consumer sees.
 */
const shippedSurface = (request: ExportScanRequest): ShippedSurface => {
  const root = resolve(request.root);
  const build = parseConfig(join(root, request.buildConfig));

  const { outDir, rootDir } = build.options;
  if (outDir === undefined || rootDir === undefined) {
    throw new Error(
      `${request.buildConfig} must state both outDir and rootDir: each emitted declaration folds back to its source through them`,
    );
  }

  const emitted = emitDeclarations(build, request.buildConfig);
  const emit = declarationProgram(emitted, build.options);
  const emitChecker = emit.getTypeChecker();

  const manifest = JSON.parse(
    readFileSync(join(root, request.manifest ?? "package.json"), "utf8"),
  ) as { readonly exports?: unknown };

  /**
   * The map's declaration targets, which are the roots. A `default` condition
   * names the `.js` beside them, carrying no declarations of its own, so it
   * folds onto the same entry rather than adding one.
   */
  const entryFiles = new Set(
    exportTargets(manifest.exports)
      .map((target) => resolve(root, target).replace(/\.js$/, ".d.ts"))
      .filter((path) => emitted.has(path)),
  );
  if (entryFiles.size === 0) {
    throw new Error(
      `no exports-map target of ${request.manifest ?? "package.json"} names a declaration ${request.buildConfig} emits`,
    );
  }

  /** The exports of one emitted declaration. */
  const emitExports = (path: string): readonly ts.Symbol[] => {
    const sf = emit.getSourceFile(path);
    if (!sf) {
      throw new Error(`${relPath(root, path)} is not in the declaration emit`);
    }
    const modSym = emitChecker.getSymbolAtLocation(sf);
    return modSym ? emitChecker.getExportsOfModule(modSym) : [];
  };

  const reachable = new Set<ts.Symbol>();
  const entryExported = new Set<ts.Symbol>();
  const frontier: ts.Symbol[] = [];
  const reach = (sym: ts.Symbol | undefined): void => {
    if (!sym) return;
    const target = unalias(emitChecker, sym);
    if (reachable.has(target)) return;
    reachable.add(target);
    frontier.push(target);
  };

  for (const entry of entryFiles) {
    for (const sym of emitExports(entry)) {
      entryExported.add(unalias(emitChecker, sym));
      reach(sym);
    }
  }

  for (let sym = frontier.pop(); sym !== undefined; sym = frontier.pop()) {
    for (const decl of sym.declarations ?? []) {
      // A module symbol on the frontier is an `export * as ns` — the whole
      // module is public under a name, so every one of its exports is reached.
      if (ts.isSourceFile(decl)) {
        for (const nested of emitChecker.getExportsOfModule(sym)) reach(nested);
        continue;
      }
      const visit = (node: ts.Node): void => {
        // A private member is not public surface: the emit carries no type for
        // one, so nothing it would have named is readable.
        if (isPrivateMember(node)) return;
        if (ts.isTypeReferenceNode(node)) {
          reach(emitChecker.getSymbolAtLocation(node.typeName));
        } else if (ts.isTypeQueryNode(node)) {
          reach(emitChecker.getSymbolAtLocation(node.exprName));
        } else if (ts.isImportTypeNode(node) && node.qualifier) {
          reach(emitChecker.getSymbolAtLocation(node.qualifier));
        } else if (ts.isExpressionWithTypeArguments(node)) {
          reach(emitChecker.getSymbolAtLocation(node.expression));
        }
        ts.forEachChild(node, visit);
      };
      ts.forEachChild(decl, visit);
    }
  }

  return {
    root,
    build,
    emitted,
    emit,
    emitChecker,
    entryFiles,
    entryExported,
    reachable,
    /**
     * `outDir` and `rootDir` are already absolute here (the config parser
     * resolves them), so the fold is the one `tsc` performed in reverse.
     */
    sourceOf: (emittedPath) =>
      resolve(rootDir, relative(outDir, emittedPath)).replace(/\.d\.ts$/, ".ts"),
  };
};

/**
 * Every name a consumer can write against the shipped surface — what the
 * `exports` map reaches, rather than the map's own entry list.
 *
 * The map names two modules; everything a chain author actually writes is a
 * member or a literal arm of what those two hand out (`Phase.writablePaths`,
 * a gate's `afterCommit`), and a set built from the entry list alone would
 * hold almost none of it.
 */
export interface PackageSurface {
  /**
   * The shipped modules the manifest's `exports` map names, relative to the
   * request's root and folded back to the sources they are built from.
   */
  readonly entryModules: readonly string[];
  /**
   * Every name the walk reached: an exported symbol, a member of one, an enum
   * member, and the string arms a reached type spells its own vocabulary in.
   */
  readonly names: ReadonlySet<string>;
}

/**
 * A declared name as a consumer writes it. A computed or private member is
 * reached by no import specifier and named by nothing a page can write, so it
 * contributes nothing.
 */
const declaredName = (name: ts.PropertyName | undefined): string | undefined => {
  if (name === undefined) return undefined;
  if (ts.isIdentifier(name) || ts.isStringLiteral(name)) return name.text;
  return undefined;
};

/**
 * The names the shipped surface holds.
 *
 * Three kinds, each a spelling a page reaches for. A **reached symbol's own
 * name** is the export and the type. A **member name** is how a chain author
 * addresses one — `writablePaths`, `flumeDir` — read off every declaration
 * the walk reached, nested type literals included, since an inline object
 * type is addressed exactly like a named one. And a **string literal type**
 * is a vocabulary the surface declares rather than a value it happens to
 * carry: `afterCommit` and `"fanout"` are names the interface holds, and a
 * page naming one is naming the surface.
 */
export const packageSurface = (request: ExportScanRequest): PackageSurface => {
  const surface = shippedSurface(request);
  const names = new Set<string>();

  const walk = (node: ts.Node): void => {
    if (isPrivateMember(node)) return;
    if (
      ts.isPropertySignature(node) ||
      ts.isPropertyDeclaration(node) ||
      ts.isMethodSignature(node) ||
      ts.isMethodDeclaration(node) ||
      ts.isGetAccessorDeclaration(node) ||
      ts.isSetAccessorDeclaration(node)
    ) {
      const name = declaredName(node.name);
      if (name !== undefined) names.add(name);
    } else if (ts.isEnumMember(node)) {
      const name = declaredName(node.name);
      if (name !== undefined) names.add(name);
    } else if (ts.isLiteralTypeNode(node) && ts.isStringLiteral(node.literal)) {
      names.add(node.literal.text);
    }
    ts.forEachChild(node, walk);
  };

  for (const sym of surface.reachable) {
    names.add(sym.getName());
    for (const decl of sym.declarations ?? []) {
      if (ts.isSourceFile(decl)) continue;
      if (!surface.emitted.has(resolve(decl.getSourceFile().fileName))) continue;
      ts.forEachChild(decl, walk);
    }
  }

  return {
    entryModules: [...surface.entryFiles].map((f) =>
      relPath(surface.root, surface.sourceOf(f)),
    ),
    names,
  };
};

/**
 * Scan a package's shipped modules for exports nothing earns.
 *
 * Reachability starts at the `exports` map's entry declarations and expands
 * through **type positions only** — a type reference, a `typeof` query, an
 * `import()` type, a heritage clause — descending into namespace and interface
 * members. Over the emit that restriction costs nothing: a `.d.ts` holds no
 * function bodies to skip, so what the walk sees is what a consumer sees.
 *
 * The same walk carries a second, stricter verdict alongside it. Reachability
 * asks whether a consumer can *read* a type; `unnamable` asks whether one can
 * *write* it — a type named by a signature or a property position is nameable
 * only when some entry module exports it under a name an import specifier can
 * carry.
 */
export const scanExports = (request: ExportScanRequest): ExportScan => {
  const surface = shippedSurface(request);
  const { root, build, emitted, emitChecker, entryExported, reachable, sourceOf } =
    surface;

  const domain = repoProgram(request);
  const { program, checker } = domain;

  /** The exports of one source module, in the consumer-wide program. */
  const sourceExports = (path: string): readonly ts.Symbol[] => {
    const sf = program.getSourceFile(path);
    if (!sf) {
      throw new Error(
        `${relPath(root, path)} is not in the program ${request.programConfig} describes`,
      );
    }
    const modSym = checker.getSymbolAtLocation(sf);
    return modSym ? checker.getExportsOfModule(modSym) : [];
  };

  // --- types the exports map reaches but cannot hand out ------------------
  // Reachability above proves a type is *readable*: it sits in the emitted
  // `.d.ts` and hover text shows it. It does not prove the type is
  // *nameable* — a consumer writing `const o: RenderOptions = …` needs an
  // import specifier, and only an entry module's own export list supplies
  // one. So this arm re-asks the stricter question over the positions the map
  // reaches: every type one of them names, declared in the shipped tree, must
  // be exported by some entry module.
  //
  // A position is an annotation a consumer reads but may not be able to
  // write — a function's parameters and return, and a property's own type.
  // Scope is every position a reached symbol carries: the reached function or
  // variable itself, and the members of a reached type. `Chain.worktreesBase`
  // names a parameter type and `FlumeApi.paths` a property type, each of which
  // a chain author must be able to annotate exactly as `renderPrompt`'s
  // parameter demands.
  //
  // Reading the emit rather than the sources is what makes that scope hold: a
  // `const` the source leaves un-annotated still ships an annotation, written
  // by `tsc`, and a walk over source nodes finds none and judges nothing.
  //
  // Three exclusions, each for the reason the verdict exists. A `private`
  // member carries no annotation into the emit at all. A namespace member is
  // named through its namespace rather than through an import specifier. And
  // a type alias's own type node is a *second name* for what it points at
  // rather than a position naming it — importing the alias imports the type —
  // so the walk descends through one without reporting it.
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
   * Every position one emitted declaration carries. A `function` is a
   * signature; so is a `const` the emit typed with a function type, while any
   * other type it carries is a property position — and a `const` the emit gave
   * a literal initializer instead of a type names nothing at all. An interface
   * or a class carries its members' positions rather than one of its own, and
   * so does a type alias — except that the alias's own type node is descended
   * into rather than reported, being the name it was reached under. A
   * namespace and an enum carry none the map hands out by name.
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
    } else if (ts.isInterfaceDeclaration(decl) || ts.isClassDeclaration(decl)) {
      fromMembers(decl.members, name, out);
    } else if (ts.isTypeAliasDeclaration(decl)) {
      fromAnnotation(decl.type, name, out, /* reportsItself */ false);
    }
    return out;
  };

  const positions: ExportPosition[] = [];
  const unnamable: UnnamableType[] = [];
  const reported = new Set<string>();

  for (const owner of reachable) {
    for (const decl of owner.declarations ?? []) {
      if (ts.isSourceFile(decl)) continue;
      const file = decl.getSourceFile();
      if (!emitted.has(resolve(file.fileName))) continue;
      if (inNamespace(decl)) continue;

      for (const found of positionsOf(decl, owner.getName())) {
        const position: ExportPosition = {
          module: relPath(root, file.fileName),
          name: found.name,
          line:
            file.getLineAndCharacterOfPosition(found.node.getStart()).line + 1,
          kind: found.kind,
        };
        positions.push(position);

        const named = (node: ts.Node): void => {
          if (ts.isTypeReferenceNode(node)) {
            const sym = emitChecker.getSymbolAtLocation(node.typeName);
            const target = sym ? unalias(emitChecker, sym) : undefined;
            // Where the named type is declared inside the emit. One declared
            // outside it is the consumer's own or a dependency's, and nameable
            // already.
            const shipped = (target?.declarations ?? []).filter((d) =>
              emitted.has(resolve(d.getSourceFile().fileName)),
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

  /**
   * Which names of which source module the emit walk reached, folded back
   * through `outDir`/`rootDir`. The export verdicts below are cited and fixed
   * in the sources, so reachability crosses back the way the emit came.
   */
  const reachedNames = new Map<string, Set<string>>();
  for (const sym of reachable) {
    for (const decl of sym.declarations ?? []) {
      const path = resolve(decl.getSourceFile().fileName);
      if (!emitted.has(path)) continue;
      const source = sourceOf(path);
      let names = reachedNames.get(source);
      if (!names) {
        names = new Set<string>();
        reachedNames.set(source, names);
      }
      names.add(sym.getName());
    }
  }

  // --- referenced from some other module ---------------------------------
  // One pass over every non-declaration source: each identifier that resolves
  // to a symbol records the file it was read from. A namespace import's
  // property access resolves to the same symbol a named import does; a name
  // that appears only inside a comment is no node at all and records nothing.
  const referencedFrom = new Map<ts.Symbol, Set<string>>();
  for (const sf of sourcesOf(domain)) {
    const from = resolve(sf.fileName);
    eachToken(sf, (token) => {
      if (!ts.isIdentifier(token)) return;
      const sym = checker.getSymbolAtLocation(token);
      if (!sym) return;
      const target = unalias(checker, sym);
      let files = referencedFrom.get(target);
      if (!files) {
        files = new Set<string>();
        referencedFrom.set(target, files);
      }
      files.add(from);
    });
  }

  // --- judge every export of every shipped module -------------------------
  const scanned: ExportSite[] = [];
  const reachedSites: ExportSite[] = [];
  const referencedSites: ExportSite[] = [];
  const unearned: ExportSite[] = [];

  for (const path of build.fileNames.map((f) => resolve(f))) {
    const module = relPath(root, path);
    const reached = reachedNames.get(path) ?? new Set<string>();
    for (const exported of sourceExports(path)) {
      const sym = unalias(checker, exported);
      // A barrel forwarding someone else's symbol is not declaring an export
      // of its own; the declaring module is where that one is judged.
      if (
        !sym.declarations?.some(
          (d) => resolve(d.getSourceFile().fileName) === path,
        )
      ) {
        continue;
      }
      const site = siteOf(root, sym, module);
      scanned.push(site);
      if (reached.has(sym.getName())) {
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
    entryModules: [...surface.entryFiles].map((f) => relPath(root, sourceOf(f))),
    scanned,
    findings: unearned,
    reachable: reachedSites,
    referenced: referencedSites,
    positions: { scanned: positions, findings: unnamable },
  };
};
