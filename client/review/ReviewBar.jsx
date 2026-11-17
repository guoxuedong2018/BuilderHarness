import { useEffect, useRef } from "react";
import { useSnapshot } from "valtio";

import { getHost } from "../core/host";
import { Btn, Icon, Tag } from "../core/ui";
import { frsForRoute } from "./frs";
import { reviewState } from "./store";
import "./ReviewBar.less";

/**
 * 顶层评审工具栏
 * - 左：当前页所属 FRS（点选评论会归档到这里）
 * - 右：宿主控件、宿主链接、评论模式开关、评论抽屉开关；`tools` 是同级套件的入口位
 *
 * 宿主控件（例如密度与主题切换器）由宿主自己挂进来：它们是宿主框架的组件，
 * 套件不认识，只留一个位置。放在评审工具栏而不是产品外壳里：产品外壳要与线上逐像素一致。
 *
 * 宿主链接交给宿主路由算 href，不写死路径：hash 路由下裸路径线上 404、dev 悄悄落回首页
 * （docs/DECISIONS.md 2026-09-07）。
 */
export function ReviewBar({ tools }) {
  const host = getHost();
  const snap = useSnapshot(reviewState);
  const extrasRef = useRef(null);

  useEffect(() => (host.mountExtras ? host.mountExtras(extrasRef.current) : undefined), [host]);

  const currentFrs = frsForRoute(snap.route);
  const openCount = snap.comments.filter((c) => c.route === snap.route && c.status === "open").length;
  const totalOpen = snap.comments.filter((c) => c.status === "open").length;
  const href = (route) => {
    try {
      return host.router.href(route);
    } catch {
      return "#";
    }
  };

  return (
    <div data-review-ui className="review-bar">
      <div className="rb-group">
        <span className="rb-label">FRS</span>
        {currentFrs.map((f) => (
          <Tag key={f.key} title={f.title}>
            {f.key}
          </Tag>
        ))}
      </div>

      <div className="rb-right">
        <span ref={extrasRef} className="rb-extras" />

        {(host.barLinks ?? []).map((link) => (
          <a key={link.label} href={href(link.route)} target="_blank" rel="noopener noreferrer" className="rb-link" title={link.title}>
            {link.label} <Icon name="open" size={12} />
          </a>
        ))}

        <a href={`/__decide/?${new URLSearchParams({
          ...(currentFrs.length === 1 ? { key: currentFrs[0].key } : {}),
          from: window.location.pathname + window.location.hash,
        })}`}
          target="_blank" rel="noopener noreferrer" className="rb-link">
          待决清单 <Icon name="open" size={12} />
        </a>

        {!snap.persistent && (
          <span className="rb-warn" title={snap.memoryOnly ? "评论仅存于当前会话，刷新后丢失" : "请检查开发服务连接"}>
            <Icon name="warn" size={12} /> {snap.memoryOnly ? "未持久化" : "评审服务未连接"}
          </span>
        )}
        {totalOpen > 0 && <span className="rb-count">全局待解决 {totalOpen}</span>}

        <Btn
          kind={snap.commentMode ? "primary" : undefined}
          title="点击切换常驻评论模式；也可随时按住 ⌘/Ctrl 临时圈选元素，松开恢复正常点击"
          onClick={() => (reviewState.commentMode = !reviewState.commentMode)}
        >
          <Icon name="chat" />
          {snap.commentMode ? "点选元素评论中" : "评论"}
        </Btn>
        <Btn onClick={() => (reviewState.drawerOpen = !reviewState.drawerOpen)}>
          <Icon name="list" />
          评论区{openCount > 0 ? ` · ${openCount}` : ""}
        </Btn>

        {/* 同级套件（内容检查台）的入口位：评审层不认识挂进来的是什么，由 App 组装 */}
        {tools}
      </div>
    </div>
  );
}
