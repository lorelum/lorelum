type PublicRelease = Readonly<{ cli: string }>;

type MdxJsxAttributeNode =
  | {
      readonly type: "mdxJsxAttribute";
      readonly name: string;
      readonly value?: string | null | { readonly type: "mdxJsxAttributeValueExpression" };
    }
  | { readonly type: "mdxJsxExpressionAttribute" };

type MarkdownNodeBase = {
  readonly type: string;
  readonly name?: string | null;
  attributes?: MdxJsxAttributeNode[];
  children?: MarkdownNode[];
  readonly position?: {
    readonly start: { readonly line: number; readonly column: number };
  };
};

type CodeNode = MarkdownNodeBase & {
  readonly type: "code";
  readonly lang: "sh" | "powershell";
  readonly meta: null;
  readonly value: string;
};
type MarkdownNode = MarkdownNodeBase | CodeNode;
type MarkdownRoot = { readonly type: "root"; children: MarkdownNode[] };
type SourceFile = Readonly<{ path?: string }>;

function fail(file: SourceFile, node: MarkdownNode, message: string): never {
  const path = file.path ?? "<unknown MDX file>";
  const point = node.position?.start;
  const location = point ? `${path}:${point.line}:${point.column}` : path;
  throw new Error(`${location}: ${message}`);
}

function createInstallCode(
  platform: "unix" | "windows",
  version: string,
  node: MarkdownNode,
): CodeNode {
  const isUnix = platform === "unix";
  return {
    type: "code",
    lang: isUnix ? "sh" : "powershell",
    meta: null,
    value: isUnix
      ? `curl -fsSL https://raw.githubusercontent.com/lorelum/lorelum/main/install.sh | sh -s -- --version ${version}`
      : `& ([scriptblock]::Create((irm https://raw.githubusercontent.com/lorelum/lorelum/main/install.ps1))) -Version ${version}`,
    position: node.position,
  };
}

function expandInstallNode(node: MarkdownNode, version: string, file: SourceFile): CodeNode {
  if (node.type !== "mdxJsxFlowElement") {
    return fail(file, node, "CliInstall must be a standalone block element.");
  }

  if (node.children?.length) {
    return fail(file, node, "CliInstall does not accept children.");
  }

  const attributes = node.attributes ?? [];
  const attribute = attributes[0];
  if (
    attributes.length !== 1 ||
    attribute?.type !== "mdxJsxAttribute" ||
    attribute.name !== "platform" ||
    typeof attribute.value !== "string" ||
    (attribute.value !== "unix" && attribute.value !== "windows")
  ) {
    return fail(
      file,
      node,
      'CliInstall requires exactly one static platform="unix" or platform="windows" attribute.',
    );
  }

  return createInstallCode(attribute.value, version, node);
}

function expandChildren(parent: MarkdownNode, version: string, file: SourceFile): void {
  const children = parent.children;
  if (!children) return;

  for (let index = 0; index < children.length; index += 1) {
    const child = children[index];
    if (!child) continue;

    if (
      (child.type === "mdxJsxFlowElement" || child.type === "mdxJsxTextElement") &&
      child.name === "CliInstall"
    ) {
      children[index] = expandInstallNode(child, version, file);
      continue;
    }

    expandChildren(child, version, file);
  }
}

/** Expands the supported static installation node before highlighting and Markdown export. */
export function remarkPublicRelease(publicRelease: PublicRelease) {
  return (tree: MarkdownRoot, file: SourceFile): void => {
    expandChildren(tree, publicRelease.cli, file);
  };
}
