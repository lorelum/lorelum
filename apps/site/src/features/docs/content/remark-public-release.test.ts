import { expect, test } from "bun:test";
import publicRelease from "../../../../content/public-release.json";
import { remarkPublicRelease } from "./remark-public-release";

type Root = Parameters<ReturnType<typeof remarkPublicRelease>>[0];
type Node = Root["children"][number];
type Attribute = NonNullable<Node["attributes"]>[number];

function jsxNode(input: {
  readonly type?: "mdxJsxFlowElement" | "mdxJsxTextElement";
  readonly attributes?: Attribute[];
  readonly children?: Node[];
}): Node {
  return {
    type: input.type ?? "mdxJsxFlowElement",
    name: "CliInstall",
    attributes: input.attributes ?? [{ type: "mdxJsxAttribute", name: "platform", value: "unix" }],
    children: input.children ?? [],
    position: { start: { line: 17, column: 1 } },
  } as Node;
}

function transform(children: Node[]): Root {
  const tree = { type: "root", children } as Root;
  remarkPublicRelease(publicRelease)(tree, { path: "content/docs/installation.mdx" });
  return tree;
}

test("expands Unix and Windows install nodes to concrete highlighted Markdown code", () => {
  const tree = transform([
    jsxNode({ attributes: [{ type: "mdxJsxAttribute", name: "platform", value: "unix" }] }),
    jsxNode({ attributes: [{ type: "mdxJsxAttribute", name: "platform", value: "windows" }] }),
  ]);

  expect(tree.children).toEqual([
    {
      type: "code",
      lang: "sh",
      meta: null,
      value: `curl -fsSL https://raw.githubusercontent.com/lorelum/lorelum/main/install.sh | sh -s -- --version ${publicRelease.cli}`,
      position: { start: { line: 17, column: 1 } },
    },
    {
      type: "code",
      lang: "powershell",
      meta: null,
      value: `& ([scriptblock]::Create((irm https://raw.githubusercontent.com/lorelum/lorelum/main/install.ps1))) -Version ${publicRelease.cli}`,
      position: { start: { line: 17, column: 1 } },
    },
  ]);
});

test("reports unsupported CliInstall attributes with their source file and line", () => {
  const invalidAttributeNodes = [
    jsxNode({ attributes: [{ type: "mdxJsxAttribute", name: "platform", value: "macos" }] }),
    jsxNode({
      attributes: [
        { type: "mdxJsxAttribute", name: "platform", value: "unix" },
        { type: "mdxJsxAttribute", name: "shell", value: "bash" },
      ],
    }),
    jsxNode({
      attributes: [
        { type: "mdxJsxAttribute", name: "platform", value: "unix" },
        { type: "mdxJsxAttribute", name: "platform", value: "windows" },
      ],
    }),
    jsxNode({
      attributes: [
        {
          type: "mdxJsxAttribute",
          name: "platform",
          value: { type: "mdxJsxAttributeValueExpression" },
        },
      ],
    }),
    jsxNode({ attributes: [{ type: "mdxJsxExpressionAttribute" }] }),
    jsxNode({ attributes: [] }),
  ];

  for (const node of invalidAttributeNodes) {
    expect(() => transform([node])).toThrow(
      'CliInstall requires exactly one static platform="unix" or platform="windows" attribute.',
    );
    expect(() => transform([node])).toThrow("content/docs/installation.mdx:17:1");
  }

  const invalidNodes = [
    jsxNode({ children: [{ type: "text" }] }),
    jsxNode({ type: "mdxJsxTextElement" }),
  ];
  for (const node of invalidNodes) {
    expect(() => transform([node])).toThrow("content/docs/installation.mdx:17:1");
  }
});
