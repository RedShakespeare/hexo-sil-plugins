# npm 独立发版流程

本文说明如何通过 GitHub Release 将 `hexo-sil-plugins` monorepo 中的五个
npm workspace 独立发布到 npm，以及首次发布后如何从临时 `NPM_TOKEN`
切换到 GitHub OIDC Trusted Publishing。

## 发布约定

每个插件独立维护版本号和 Git tag。Tag 必须使用：

```text
<package-name>@<semver>
```

例如：

```text
hexo-sil-assets@0.1.0
hexo-sil-audio@0.1.1
hexo-sil-podcast@0.2.0-beta.1
```

- 正式版本发布到 npm `latest` dist-tag。
- 带 SemVer 预发布后缀的版本发布到 npm `next` dist-tag。
- 一次 GitHub Release 只发布一个 workspace。
- 已发布的版本和 Git tag 不得复用、移动或覆盖。
- Release tag 必须指向 `main` 分支历史中的提交。

## 首次发布准备

五个包首次出现在 npm 之前，无法在 npm 包设置中绑定 Trusted Publisher。
因此首次发布使用一个短期 npm Token，首发完成后立即切换到 OIDC。

### 创建短期 npm Token

1. 登录 [npm](https://www.npmjs.com/)。
2. 从头像菜单进入 `Access Tokens`。
3. 选择 `Generate New Token`，创建 Granular Access Token。
4. 名称可填写 `hexo-sil-plugins-bootstrap`。
5. 设置较短有效期，例如 7 天。
6. Package 权限选择可创建和读写公开包的 `Read and write`。
7. 因为五个包尚不存在，不要把权限限制到某个已有包。
8. 如果 npm 账号要求发布 2FA，开启适用于自动化发布的 2FA bypass。
9. 生成后立即妥善保存 Token；离开页面后通常无法再次查看。

Token 不得写入 Git、Markdown、`.npmrc` 或仓库中的其他文件。

### 创建 GitHub Environment

1. 打开仓库 `Settings` -> `Environments`。
2. 点击 `New environment`。
3. Environment 名称必须为 `npm-publish`。
4. 首发阶段不要配置 Required reviewers，否则发布 Release 后还需要人工批准。
5. 在 `Environment secrets` 中点击 `Add environment secret`。
6. Secret 名称填写 `NPM_TOKEN`。
7. Secret value 填写上一步生成的 npm Token。

发布 workflow 只从 `npm-publish` Environment 读取该 Secret。

## 发布五个初始版本

当前五个 workspace 已经声明版本 `0.1.0`，首次发布不需要执行版本更新命令。
必须按依赖顺序发布：

1. `hexo-sil-assets@0.1.0`
2. `hexo-sil-audio@0.1.0`
3. `hexo-sil-archive@0.1.0`
4. `hexo-sil-podcast@0.1.0`
5. `hexo-sil-podcast-inside@0.1.0`

每个包分别执行以下操作：

1. 打开仓库的 `Releases` 页面。
2. 点击 `Draft a new release`。
3. 在 `Choose a tag` 中输入完整 tag，例如 `hexo-sil-assets@0.1.0`。
4. 选择 `Create new tag on publish`，目标分支选择 `main`。
5. Release title 使用同一个完整 tag。
6. 填写该版本的 Release notes。
7. 正式版本不要勾选 `Set as a pre-release`。
8. 点击 `Publish release`。
9. 在 GitHub `Actions` 页面等待 `Publish npm package` 成功。
10. 确认 npm 版本正确后，再创建下一个包的 Release。

发布 workflow 会自动：

- 校验 package 名称、tag 和 `package.json` 版本完全一致；
- 确认 tag 指向 `main` 历史；
- 确认 npm 上不存在相同版本；
- 运行全部 workspace 测试和 tarball 审计；
- 只发布 tag 指定的 workspace；
- 设置正确的 npm dist-tag 并生成 provenance。

发布后可从本地验证：

```sh
npm view hexo-sil-assets@0.1.0 version
npm view hexo-sil-assets dist-tags
```

预期版本为 `0.1.0`，并且 `latest` 指向 `0.1.0`。

## 切换到 Trusted Publishing

五个包都完成首次发布后，在 npm 上逐包配置 Trusted Publisher：

1. 打开包页面并进入 `Settings` -> `Trusted Publisher`。
2. Publisher 选择 GitHub Actions。
3. 填写以下值：

```text
Organization or user: RedShakespeare
Repository: hexo-sil-plugins
Workflow filename: publish.yml
Environment: npm-publish
Allowed action: npm publish
```

五个包必须分别配置。每个 npm 包同一时间只能绑定一个 Trusted Publisher。

全部绑定完成后：

1. 回到 GitHub `Settings` -> `Environments` -> `npm-publish`。
2. 删除 `NPM_TOKEN` Environment Secret。
3. 在每个 npm 包的 Publishing access 中启用要求 2FA 并禁止传统 Token 发布。
4. 撤销或等待首次发布使用的短期 npm Token 过期。

此后 `publish.yml` 使用 GitHub OIDC 短期凭据，不再需要长期 npm Token；npm
会为公开仓库和公开包自动生成 provenance。

## 后续正式版本

先使用 workspace 发布工具更新目标包：

```sh
npm run release:prepare -- hexo-sil-audio patch
npm run check
```

`release:prepare` 只更新目标包版本和 `package-lock.json`。如果新版本超出其他
workspace 声明的 peer dependency 范围，它会给出警告，但不会隐式修改或发布
其他包。

检查变更后提交并推送：

```sh
git add packages/hexo-sil-audio/package.json package-lock.json
git commit -m "[release] hexo-sil-audio 0.1.1"
git push origin main
```

等待 `CI` workflow 成功，然后创建 GitHub Release：

```text
hexo-sil-audio@0.1.1
```

也可以指定完整版本，而不是 `major`、`minor` 或 `patch`：

```sh
npm run release:prepare -- hexo-sil-audio 1.0.0
```

## 预发布版本

准备预发布版本时必须显式提供完整 SemVer：

```sh
npm run release:prepare -- hexo-sil-audio 0.2.0-beta.1
```

提交版本变更后创建：

```text
hexo-sil-audio@0.2.0-beta.1
```

创建 GitHub Release 时必须勾选 `Set as a pre-release`。Workflow 会将该版本
发布到 npm `next`，不会修改 `latest`。

准备正式版时再更新为不带预发布后缀的版本：

```sh
npm run release:prepare -- hexo-sil-audio 0.2.0
```

## 失败处理

### npm 发布前失败

如果 workflow 在 `npm publish` 之前失败：

1. 不要移动或删除 Release tag。
2. 修复代码、Token、Environment 或 Trusted Publisher 配置。
3. 如果修复不需要改变 tag 对应代码，直接在 Actions 中选择 `Re-run jobs`。
4. 如果必须修改代码或版本，应创建新的版本和新 tag，不要移动已经公开的 tag。

### npm 已发布但 workflow 后续失败

先运行：

```sh
npm view <package>@<version> version
```

如果 npm 已经存在该版本，不要重新发布或重建 Release。npm 版本不可覆盖，workflow
的重复版本保护也会主动拒绝再次发布。

### 常见校验失败

- Tag 必须严格使用 `<package>@<version>`，不能写 `v0.1.0`。
- Tag 版本必须与对应 workspace 的 `package.json` 完全一致。
- GitHub Release 的 pre-release 状态必须与 SemVer 是否含预发布后缀一致。
- Release tag 必须来自 `main`。
- npm 上已经存在的版本不能再次发布。

## 发布前检查清单

- 目标 workspace 版本和 lockfile 已提交。
- `npm run check` 已通过。
- `main` 的 GitHub CI 已通过。
- Tag 名称、包名和版本完全一致。
- 正式版使用 `latest`，预发布版使用 `next`。
- 首发阶段 `NPM_TOKEN` 位于 `npm-publish` Environment。
- OIDC 阶段五个包均已绑定 `publish.yml` Trusted Publisher。
