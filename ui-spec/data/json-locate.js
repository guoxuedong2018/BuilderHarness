/**
 * 在一段写到一半的 JSON 里找位置：不要求整段合法，按引号、括号、逗号一路数过去。
 * 给代码配置用——光标在哪一块、正在写哪个键的值，预览里点一块编辑器跳到哪。
 */

/**
 * 光标（全文第 offset 个字符）处的情况：
 *   frames   外到内每一层容器：{ type: "object", key, expectKey } 或 { type: "array", index }；
 *            key 是正在写的那个键（冒号之后才有），expectKey 为真表示该写键名了，index 是数组里第几项
 *   inString 光标在一对引号里；stringStart 是这对引号的左引号位置
 */
export function locate(text, offset) {
  const frames = [];
  let inString = false;
  let stringStart = -1;
  let esc = false;
  const top = () => frames[frames.length - 1];
  for (let i = 0; i < offset && i < text.length; i += 1) {
    const c = text[i];
    if (inString) {
      if (esc) esc = false;
      else if (c === "\\") esc = true;
      else if (c === '"') {
        inString = false;
        const f = top();
        if (f && f.type === "object" && f.expectKey) {
          try { f.pendingKey = JSON.parse(text.slice(stringStart, i + 1)); }
          catch { f.pendingKey = text.slice(stringStart + 1, i); }
        }
      }
      continue;
    }
    if (c === '"') {
      inString = true;
      stringStart = i;
    } else if (c === "{") frames.push({ type: "object", start: i, expectKey: true, key: null, pendingKey: null });
    else if (c === "[") frames.push({ type: "array", start: i, index: 0 });
    else if (c === "}" || c === "]") frames.pop();
    else if (c === ":" && top() && top().type === "object") {
      top().key = top().pendingKey;
      top().expectKey = false;
    } else if (c === "," && top()) {
      const f = top();
      if (f.type === "array") f.index += 1;
      else Object.assign(f, { expectKey: true, key: null, pendingKey: null });
    }
  }
  return { frames, inString, stringStart };
}

/** 最外层是数组时，它的每一个对象项从哪到哪（左花括号到右花括号）；写到一半没收口的那项 end 为 -1 */
export function rootItems(text) {
  const items = [];
  const stack = [];
  let inString = false;
  let esc = false;
  for (let i = 0; i < text.length; i += 1) {
    const c = text[i];
    if (inString) {
      if (esc) esc = false;
      else if (c === "\\") esc = true;
      else if (c === '"') inString = false;
      continue;
    }
    if (c === '"') inString = true;
    else if (c === "{" || c === "[") {
      if (c === "{" && stack.length === 1 && stack[0] === "[") items.push({ start: i, end: -1 });
      stack.push(c);
    } else if (c === "}" || c === "]") {
      stack.pop();
      if (c === "}" && stack.length === 1 && stack[0] === "[" && items.length) items[items.length - 1].end = i;
    }
  }
  return items;
}

/** JSON.parse 报错里的位置换成第几行（浏览器写法不一，取不到就是 0） */
export function errorLine(text, message) {
  const line = String(message).match(/line (\d+)/);
  if (line) return Number(line[1]);
  const pos = String(message).match(/position (\d+)/);
  return pos ? text.slice(0, Number(pos[1])).split("\n").length : 0;
}
