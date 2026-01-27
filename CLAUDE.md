# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

SeeDream MCP Server - 让 Claude Code 直接生成图片的 MCP 服务器，基于 BytePlus SeeDream 4.5 模型。

提供 5 个工具：
- `seedream_generate` - 文本生成图片
- `seedream_edit` - 编辑现有图片（单图参考）
- `seedream_blend` - 多图融合（2-14 张）
- `seedream_variations` - 批量生成变体（2-15 张）
- `seedream_status` - 服务状态检查（不消耗 API 配额）

## Commands

```bash
npm run dev      # 开发模式（tsx watch）
npm run build    # TypeScript 编译到 dist/
npm start        # 运行编译后的服务器

# 环境变量
ARK_API_KEY="your-key"           # 必需
TRANSPORT="stdio"                 # stdio（默认）或 http
PORT=3000                         # HTTP 模式端口
```

## Architecture

```
src/
├── index.ts              # 入口点（stdio + http 双模式）
├── services/
│   └── seedream.ts       # SeeDream API 客户端（核心业务逻辑）
├── schemas/
│   └── index.ts          # Zod 验证 schema（输入 + 输出）
└── tools/
    ├── generate.ts       # 文本生成图片
    ├── edit.ts           # 图片编辑
    ├── blend.ts          # 多图融合
    ├── variations.ts     # 批量变体
    └── status.ts         # 健康检查
```

### 数据流

```
Tool Handler → Zod 验证 → generateImages() → SeeDream API → 并行下载 → 格式化输出
```

### 关键设计

**services/seedream.ts** - API 客户端：
- 并行下载（最多 4 张）
- Base64 编码缓存（LRU, 5 分钟 TTL）
- 指数退避重试（最多 2 次）
- 性能计时指标

**schemas/index.ts** - 验证层：
- 输入 schema（严格模式，拒绝额外字段）
- 输出 schema（支持 structuredContent）
- 8 种尺寸：2K, 4K, 1:1, 4:3, 3:4, 16:9, 9:16, 3:2, 2:3, 21:9

**tools/*.ts** - 工具注册：
- 每个工具注册到 MCP Server
- 支持 Markdown 和 JSON 两种输出格式
- 包含详细的工具描述（作为 LLM 使用指南）

## API 最佳实践

参考官方文档：https://docs.byteplus.com/en/docs/ModelArk/1541523

**三种生成模式**：
| 模式 | API 参数 |
|------|----------|
| text | `sequential_image_generation: "auto"` |
| image | `image: [单张]`, `sequential_image_generation: "auto"` |
| multi | `image: [2-14张]`, `sequential_image_generation: "disabled"` ← 关键 |

**重要**：
- 不要修改用户 prompt，模型自动检测批量关键词
- multi-image 模式必须禁用 sequential_image_generation
- 1K 尺寸仅 Seedream 4.0 支持，4.5 不支持

## 添加新工具

1. 在 `schemas/index.ts` 添加输入/输出 schema
2. 在 `tools/` 创建工具文件
3. 在 `index.ts` 导入并调用 `registerXxxTool(server)`

工具模板：
```typescript
export function registerMyTool(server: McpServer): void {
  server.registerTool(
    "seedream_mytool",
    {
      title: "My Tool",
      description: "详细描述（作为 LLM 使用指南）",
      inputSchema: MyInputSchema,
      outputSchema: MyOutputSchema,
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: false,
        openWorldHint: true,
      },
    },
    async (params: MyInput) => {
      // 实现
    }
  );
}
```
