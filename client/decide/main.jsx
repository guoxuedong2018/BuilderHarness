/**
 * 决策页入口（server/decide-server.js 伺服在 /__decide/）。
 *
 * 独立页面，不挂原型：宿主的外观（配色变量、字体、亮暗主题）从 vite.config.js 的 pageLook 带进来，
 * 套件样式里的 @color-* 才有值、暗色才跟着变。
 */
import "../core/tokens.css";
import "virtual:builderharness/page-look";

import { createRoot } from "react-dom/client";

import { DecideRoot } from "./DecideRoot";
import { refresh } from "./store";

const el = document.getElementById("bk-decide");
el.className = "bk-root";
createRoot(el).render(<DecideRoot />);

// README 或收件箱一变，dev 服务推一声：Agent 记完一条，那张卡当场变「已定」
import.meta.hot?.on("bk-decide:changed", refresh);
