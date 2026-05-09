import type { ProjectScan, QuestionNode } from "../shared/types";

const nodes: QuestionNode[] = [
  {
    id: "c1_m1",
    conversationId: "chat-1",
    conversationTitle: "项目启动与需求分析",
    messageId: "m1",
    prompt: "我们要开发一个 ChatGPT 项目分支树插件，首先需要做什么？",
    promptPreview: "我们要开发一个 ChatGPT 项目分支树插件，首先需要做什么？",
    fingerprint: "c1_m1",
    url: "https://chatgpt.com/c/chat-1",
    source: "internal",
    index: 0
  },
  {
    id: "c1_m2",
    conversationId: "chat-1",
    conversationTitle: "项目启动与需求分析",
    messageId: "m2",
    prompt: "如何获取 ChatGPT 页面上的历史对话数据？",
    promptPreview: "如何获取 ChatGPT 页面上的历史对话数据？",
    fingerprint: "c1_m2",
    url: "https://chatgpt.com/c/chat-1",
    source: "internal",
    index: 1
  },
  {
    id: "c1_m3",
    conversationId: "chat-1",
    conversationTitle: "项目启动与需求分析",
    messageId: "m3",
    prompt: "好的，那如果用内部 API 拦截呢？有思路吗？",
    promptPreview: "好的，那如果用内部 API 拦截呢？有思路吗？",
    fingerprint: "c1_m3",
    url: "https://chatgpt.com/c/chat-1",
    source: "internal",
    index: 2
  },
  {
    id: "c2_m1",
    conversationId: "chat-2",
    conversationTitle: "UI 设计与 D3 渲染",
    messageId: "m4",
    prompt: "帮我用 D3 和 React 设计一个分支树的组件。",
    promptPreview: "帮我用 D3 和 React 设计一个分支树的组件。",
    fingerprint: "c2_m1",
    url: "https://chatgpt.com/c/chat-2",
    source: "internal",
    index: 0
  },
  {
    id: "c2_m2",
    conversationId: "chat-2",
    conversationTitle: "UI 设计与 D3 渲染",
    messageId: "m5",
    prompt: "怎么支持拖拽节点并保存位置？",
    promptPreview: "怎么支持拖拽节点并保存位置？",
    fingerprint: "c2_m2",
    url: "https://chatgpt.com/c/chat-2",
    source: "internal",
    index: 1
  },
  {
    id: "c2_m3",
    conversationId: "chat-2",
    conversationTitle: "UI 设计与 D3 渲染",
    messageId: "m6",
    prompt: "不用 drag，用 pointer 事件实现一下。",
    promptPreview: "不用 drag，用 pointer 事件实现一下。",
    fingerprint: "c2_m3",
    url: "https://chatgpt.com/c/chat-2",
    source: "internal",
    index: 2,
    parentId: "c2_m1"
  },
  {
    id: "c3_m1",
    conversationId: "chat-3",
    conversationTitle: "DOM 扫描降级方案",
    messageId: "m7",
    prompt: "如果 API 拦截失败，如何通过 DOM 扫描当前对话的提问？",
    promptPreview: "如果 API 拦截失败，如何通过 DOM 扫描当前对话的提问？",
    fingerprint: "c3_m1",
    url: "https://chatgpt.com/c/chat-3",
    source: "dom",
    index: 0
  }
];

export const sampleScan: ProjectScan = {
  projectId: "gpt-branch-tree",
  projectName: "ChatGPT 分支树插件",
  isProject: true,
  sourceMode: "mixed",
  scannedUrl: "https://chatgpt.com/g/gpt-branch-tree/project",
  lastScanAt: new Date().toISOString(),
  warnings: ["演示模式：在 Chrome 中安装扩展后即可扫描真实 ChatGPT 项目。"],
  conversations: [
    {
      id: "chat-1",
      title: "项目启动与需求分析",
      url: "https://chatgpt.com/c/chat-1",
      nodes: [nodes[0], nodes[1], nodes[2]]
    },
    {
      id: "chat-2",
      title: "UI 设计与 D3 渲染",
      url: "https://chatgpt.com/c/chat-2",
      nodes: [nodes[3], nodes[4], nodes[5]]
    },
    {
      id: "chat-3",
      title: "DOM 扫描降级方案",
      url: "https://chatgpt.com/c/chat-3",
      nodes: [nodes[6]]
    }
  ],
  nodes,
  edges: [
    { from: "c1_m1", to: "c1_m2", kind: "inferred" },
    { from: "c1_m2", to: "c1_m3", kind: "inferred" },
    { from: "c2_m1", to: "c2_m2", kind: "inferred" },
    { from: "c2_m1", to: "c2_m3", kind: "observed" }
  ]
};
