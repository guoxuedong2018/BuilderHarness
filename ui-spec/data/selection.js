/** Keep selection by stable row ID across pages or regenerated row objects. */
const addKeys = (current, keys) => [...new Set([...current, ...keys.filter((key) => key != null)])];

const removeKeys = (current, keys) => {
  const dropped = new Set(keys);
  return current.filter((key) => !dropped.has(key));
};

/**
 * 给当前页的行打上 `_checked`。
 *
 * 这是 iView Table 读取初始勾选态的约定字段——翻回上一页时靠它还原勾选，
 * 少了这一步，选中集是对的但界面上的勾没了，用户会重新勾一遍。
 */
const markRows = (rows, keys, keyField, checkedField = "_checked") => {
  const picked = new Set(keys);
  return rows.map((row) => ({ ...row, [checkedField]: picked.has(row[keyField]) }));
};

/**
 * 一份独立的选中集。返回的对象放进 `data()` 即可获得响应式。
 *
 * 方法都写成箭头函数以外的普通方法，靠 `this` 指向对象自身——放进 data 后
 * Vue 会把它整个观察起来，`this.keys = …` 的赋值能触发更新。
 */
export function createSelection(keyField = "id", { checkedField = "_checked" } = {}) {
  return {
    keys: [],
    mark(rows) {
      return markRows(rows, this.keys, keyField, checkedField);
    },
    select(rows) {
      this.keys = addKeys(
        this.keys,
        rows.map((row) => row[keyField]),
      );
    },
    deselect(rows) {
      this.keys = removeKeys(
        this.keys,
        rows.map((row) => row[keyField]),
      );
    },
    /** 直接按标识选中，用于「选择全部 N 条筛选结果」这类不经过行对象的入口 */
    selectKeys(keys) {
      this.keys = addKeys(this.keys, keys);
    },
    deselectKeys(keys) {
      this.keys = removeKeys(this.keys, keys);
    },
    clear() {
      this.keys = [];
    },
  };
}

export function vue2CrossPageSelection(keyField = "id") {
  return {
    data() {
      return { selectedKeys: [] };
    },
    computed: {
      selectedCount() {
        return this.selectedKeys.length;
      },
      hasSelection() {
        return this.selectedKeys.length > 0;
      },
    },
    methods: {
      markSelected(rows) {
        return markRows(rows, this.selectedKeys, keyField);
      },
      selectRows(rows) {
        this.selectKeys(rows.map((row) => row[keyField]));
      },
      deselectRows(rows) {
        this.selectedKeys = removeKeys(
          this.selectedKeys,
          rows.map((row) => row[keyField]),
        );
      },
      /** 直接按标识选中，用于「选择全部 N 条筛选结果」这类不经过行对象的入口 */
      selectKeys(keys) {
        this.selectedKeys = addKeys(this.selectedKeys, keys);
      },
      clearSelection() {
        this.selectedKeys = [];
      },
    },
  };
}
