# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

SeeDream MCP Server - 让 Claude 直接生成图片的 MCP 服务器，基于 BytePlus SeeDream 4.5 模型。

**部署地址**: https://seedream-mcp-server-production.up.railway.app

**可用工具** (6 个):

| 工具 | 用途 | Claude Code | Claude.ai |
|------|------|-------------|-----------|
| `seedream_generate` | 文本生成图片 | ✅ | ❌ 超时 |
| `seedream_edit` | 编辑现有图片 | ✅ | ❌ 超时 |
| `seedream_blend` | 多图融合 (2-14 张) | ✅ | ❌ 超时 |
| `seedream_variations` | 批量变体 (2-15 张) | ✅ | ❌ 超时 |
| `seedream_submit` | 提交任务，Web App 查看 | ✅ | ✅ |
| `seedream_status` | 服务状态检查 | ✅ | ✅ |

## Commands

```bash
npm run dev      # 开发模式（tsx watch）
npm run build    # TypeScript 编译到 dist/
npm start        # 运行编译后的服务器

# 环境变量（必需）
ARK_API_KEY="your-key"           # SeeDream API 密钥

# 环境变量（传输模式）
TRANSPORT="stdio"                 # stdio（默认）或 http
PORT=3000                         # HTTP 模式端口

# 环境变量（Firebase 同步）
FIREBASE_SERVICE_ACCOUNT='{"type":"service_account",...}'
FIREBASE_USER_ID="your-uid"
FIREBASE_USER_NAME="Your Name"
```

## Architecture

```
src/
├── index.ts              # 入口点（stdio + http 双模式）
├── services/
│   ├── seedream.ts       # SeeDream API 客户端（流式响应、并行下载）
│   └── firebase.ts       # Firebase Admin SDK（Storage + Firestore）
├── schemas/
│   └── index.ts          # Zod 验证 schema（输入 + 输出）
└── tools/
    ├── generate.ts       # 文本生成图片（Claude Code 专用）
    ├── edit.ts           # 图片编辑
    ├── blend.ts          # 多图融合
    ├── variations.ts     # 批量变体
    ├── submit.ts         # 异步提交（Claude.ai 专用）
    └── status.ts         # 健康检查
```

### 两种使用模式

**Claude Code (本地)**:
```
seedream_generate → 同步返回图片 URL → 自动同步到 Firebase
```

**Claude.ai / MCP Submit**:
```
seedream_submit → 创建任务到 Firestore (status='pending')
                           ↓
        Cloud Function (processGenerationTask) 处理
                           ↓
        生成图片 → 上传 Storage → 更新任务状态
                           ↓
        前端通过 Firestore 实时订阅获取更新
                           ↓
        https://seedream-gallery.firebaseapp.com
```

### 关键设计

**v2.3.0 架构变更**:
- `seedream_submit` 只创建任务，**不**自己处理
- 所有任务由 Cloud Function 统一处理（避免竞态条件和 OOM）
- MCP 和 Web App 使用相同的处理流程

**services/seedream.ts** - API 客户端 (供 seedream_generate 等本地工具使用):
- 流式响应处理 (`image_generation.partial_succeeded`)
- 并行 API 调用（每个调用生成 1 张图片）
- 并行下载（最多 4 张）
- Base64 编码缓存（LRU, 5 分钟 TTL）

**services/firebase.ts** - Firebase 集成:
- `syncImageToFirebase()` - 上传 Storage + 写入 `images` 集合
- `createTaskWithId()` - 创建任务记录（供 Cloud Function 处理）
- 所有写入必须过滤 `undefined` 值（Firestore 限制）

**tools/submit.ts** - Claude.ai 兼容 (v2.3.0):
- 只创建任务到 Firestore，立即返回
- Cloud Function 自动处理任务（9 分钟超时）
- 更可靠、更简单、无 OOM 风险

## API 最佳实践

**三种生成模式**:
| 模式 | API 参数 |
|------|----------|
| text | `sequential_image_generation: "auto"` |
| image | `image: [单张]`, `sequential_image_generation: "auto"` |
| multi | `image: [2-14张]`, `sequential_image_generation: "disabled"` ← 关键 |

**重要**:
- multi-image 模式必须禁用 `sequential_image_generation`
- 1K 尺寸仅 Seedream 4.0 支持，4.5 不支持
- Firestore 不接受 `undefined` 值，必须过滤或使用 `null`

## 添加新工具

1. 在 `schemas/index.ts` 添加输入/输出 schema
2. 在 `tools/` 创建工具文件
3. 在 `index.ts` 导入并调用 `registerXxxTool(server)`

工具模板:
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
