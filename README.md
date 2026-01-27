# SeeDream MCP Server

[![npm version](https://badge.fury.io/js/seedream-mcp-server.svg)](https://www.npmjs.com/package/seedream-mcp-server)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

让 Claude Code 直接生成图片的 MCP 服务器，基于 BytePlus SeeDream 4.5 模型。

[English](#english) | [中文](#中文)

---

## 中文

### ✨ 功能

| 工具 | 说明 | 示例 |
|------|------|------|
| `seedream_generate` | 文本生成图片 | "生成一张赛博朋克城市夜景" |
| `seedream_edit` | 编辑现有图片 | "给人物加上墨镜" |
| `seedream_blend` | 多图融合 | "把图1人物穿上图2衣服" |
| `seedream_variations` | 批量生成变体 | "生成4个不同配色方案" |
| `seedream_status` | 检查服务状态 | 验证 API Key 和服务健康状态 |

### ⚡ v1.3.0 Web App 同步（最新）

- **Firebase 集成**: 生成的图片自动同步到 Web App 共享图库
- **无需登录**: 所有人都能在 Web App 看到 MCP 生成的图片
- **Like 收藏**: 用户登录后可以 like 收藏喜欢的图片

### ⚡ v1.2.0 流式生成

- **流式 API**: 图片生成一张返回一张，无需等待全部完成，体感速度大幅提升
- **实时下载**: 边生成边下载，图片到达即开始保存

### ⚡ v1.1.0 性能优化

- **并行下载**: 最多 4 张图片同时下载，批量生成速度提升 ~60%
- **智能缓存**: Base64 编码缓存，重复使用相同图片无需重新编码
- **自动重试**: 下载失败自动重试 2 次，带指数退避
- **性能指标**: 每次生成显示详细耗时（生成/下载/总计）
- **结构化输出**: 所有工具支持 `outputSchema`，便于程序化处理
- **HTTP 模式**: 支持作为远程服务器部署（设置 `TRANSPORT=http`）

### 🚀 快速开始

#### 1. 获取 API Key

访问 [BytePlus ModelArk Console](https://console.byteplus.com/ark/region:ark+ap-southeast-1/apiKey) 获取 API Key。

#### 2. 设置环境变量

```bash
# macOS/Linux
echo 'export ARK_API_KEY="your-api-key"' >> ~/.zshrc
source ~/.zshrc

# Windows (PowerShell)
[Environment]::SetEnvironmentVariable("ARK_API_KEY", "your-api-key", "User")
```

#### 3. 配置 Claude Code

在你的项目根目录创建 `.mcp.json`：

```json
{
  "mcpServers": {
    "seedream": {
      "type": "stdio",
      "command": "npx",
      "args": ["-y", "seedream-mcp-server"],
      "env": {
        "ARK_API_KEY": "${ARK_API_KEY}"
      }
    }
  }
}
```

或者添加到全局配置 `~/.claude.json`：

```json
{
  "mcpServers": {
    "seedream": {
      "type": "stdio",
      "command": "npx",
      "args": ["-y", "seedream-mcp-server"],
      "env": {
        "ARK_API_KEY": "${ARK_API_KEY}"
      }
    }
  }
}
```

#### 4. 重启 Claude Code

重启后即可使用！

### 💬 使用示例

在 Claude Code 中直接说：

```
生成一张日本樱花树下的咖啡店，温暖的下午阳光，插画风格
```

```
把这张图片 ./photo.jpg 的背景换成星空
```

```
把 person.jpg 的人物穿上 dress.jpg 的裙子
```

```
基于这个 logo 生成6个不同配色方案
```

### 📁 输出

生成的图片会自动保存到 `./generated_images/` 目录。

输出示例（带性能指标）：
```
# Image Generated Successfully

**Prompt:** 一只橘猫在阳光下打盹
**Size:** 2K

## Generated Images

### Image 1
- **URL:** https://...
- **Local:** `./generated_images/seedream_2024-01-27_12-30-45_1.jpg`
- **Size:** 2K

## Performance
- Generation: 15.2s
- Download: 1.8s
- **Total: 17.0s**
```

---

## English

### ✨ Features

| Tool | Description | Example |
|------|-------------|---------|
| `seedream_generate` | Text-to-image | "Generate a cyberpunk city at night" |
| `seedream_edit` | Edit existing image | "Add sunglasses to the person" |
| `seedream_blend` | Blend multiple images | "Dress person in image 1 with outfit from image 2" |
| `seedream_variations` | Batch variations | "Generate 4 color variations" |
| `seedream_status` | Check server status | Verify API key and server health |

### ⚡ v1.3.0 Web App Sync (Latest)

- **Firebase Integration**: Generated images automatically sync to Web App shared gallery
- **No Login Required**: Everyone can see MCP-generated images in the Web App
- **Like & Save**: Logged-in users can like and save their favorite images

### ⚡ v1.2.0 Streaming Generation

- **Streaming API**: Images returned as they're generated, no waiting for all to complete
- **Real-time Downloads**: Download starts immediately when each image is ready

### ⚡ v1.1.0 Performance Optimizations

- **Parallel Downloads**: Up to 4 concurrent image downloads, ~60% faster for batch generation
- **Smart Caching**: Base64 encoding cache for repeated image inputs
- **Auto Retry**: Failed downloads retry up to 2 times with exponential backoff
- **Performance Metrics**: Detailed timing for each generation (generation/download/total)
- **Structured Output**: All tools support `outputSchema` for programmatic processing
- **HTTP Mode**: Deploy as a remote server (set `TRANSPORT=http`)

### 🚀 Quick Start

#### 1. Get API Key

Visit [BytePlus ModelArk Console](https://console.byteplus.com/ark/region:ark+ap-southeast-1/apiKey) to get your API key.

#### 2. Set Environment Variable

```bash
# macOS/Linux
echo 'export ARK_API_KEY="your-api-key"' >> ~/.zshrc
source ~/.zshrc

# Windows (PowerShell)
[Environment]::SetEnvironmentVariable("ARK_API_KEY", "your-api-key", "User")
```

#### 3. Configure Claude Code

Create `.mcp.json` in your project root:

```json
{
  "mcpServers": {
    "seedream": {
      "type": "stdio",
      "command": "npx",
      "args": ["-y", "seedream-mcp-server"],
      "env": {
        "ARK_API_KEY": "${ARK_API_KEY}"
      }
    }
  }
}
```

Or add to global config `~/.claude.json`:

```json
{
  "mcpServers": {
    "seedream": {
      "type": "stdio",
      "command": "npx",
      "args": ["-y", "seedream-mcp-server"],
      "env": {
        "ARK_API_KEY": "${ARK_API_KEY}"
      }
    }
  }
}
```

#### 4. Restart Claude Code

Restart and you're ready to go!

### 💬 Usage Examples

Just talk to Claude Code:

```
Generate a serene Japanese garden with cherry blossoms, morning mist, photorealistic
```

```
Change the background of ./photo.jpg to a beach sunset
```

```
Dress the person in person.jpg with the outfit from dress.jpg
```

```
Generate 4 seasonal variations of this coffee shop interior
```

### 📁 Output

Generated images are automatically saved to `./generated_images/`.

---

## 🔥 Firebase 同步配置 / Firebase Sync Setup

要让 MCP 生成的图片自动同步到 Web App，需要配置 Firebase Service Account：

To sync MCP-generated images to the Web App, configure Firebase Service Account:

### 1. 获取 Service Account / Get Service Account

1. 访问 [Firebase Console](https://console.firebase.google.com/project/seedream-gallery/settings/serviceaccounts/adminsdk)
2. 点击 "Generate new private key" 下载 JSON 文件
3. 将文件保存到安全位置

### 2. 配置环境变量 / Set Environment Variable

```bash
# 方法一：指定文件路径 / Method 1: File path
export FIREBASE_SERVICE_ACCOUNT_PATH="/path/to/service-account.json"

# 方法二：JSON 字符串（适合 CI/CD）/ Method 2: JSON string (for CI/CD)
export FIREBASE_SERVICE_ACCOUNT='{"type":"service_account",...}'

# 方法三：标准 GCP 方式 / Method 3: Standard GCP approach
export GOOGLE_APPLICATION_CREDENTIALS="/path/to/service-account.json"
```

### 3. 更新 MCP 配置 / Update MCP Config

```json
{
  "mcpServers": {
    "seedream": {
      "type": "stdio",
      "command": "npx",
      "args": ["-y", "seedream-mcp-server"],
      "env": {
        "ARK_API_KEY": "${ARK_API_KEY}",
        "FIREBASE_SERVICE_ACCOUNT_PATH": "${FIREBASE_SERVICE_ACCOUNT_PATH}"
      }
    }
  }
}
```

配置完成后，MCP 生成的图片会自动出现在 [SeeDream Gallery](https://seedream-gallery.firebaseapp.com) 中！

Once configured, MCP-generated images will automatically appear in [SeeDream Gallery](https://seedream-gallery.firebaseapp.com)!

---

## 🌐 HTTP 服务器模式 / HTTP Server Mode

除了默认的 stdio 模式，还可以作为 HTTP 服务器运行：

In addition to the default stdio mode, you can run as an HTTP server:

```bash
# 启动 HTTP 服务器 / Start HTTP server
TRANSPORT=http PORT=3000 ARK_API_KEY=your-key node dist/index.js

# 或使用 npx / Or using npx
TRANSPORT=http PORT=3000 ARK_API_KEY=your-key npx seedream-mcp-server
```

**端点 / Endpoints:**
- `POST /mcp` - MCP 协议端点
- `GET /health` - 健康检查
- `GET /` - 服务器信息

---

## 📝 License

MIT

## 🔗 Links

- [SeeDream Gallery Web App](https://seedream-gallery.firebaseapp.com)
- [BytePlus ModelArk](https://www.byteplus.com/en/product/modelark)
- [MCP Protocol](https://modelcontextprotocol.io)
