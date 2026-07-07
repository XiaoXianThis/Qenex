# Bug 修复记录

## 2026-07-07 - 修复 React 错误和无限循环

### 问题 1: 嵌套 button 元素
**错误信息：**
```
In HTML, <button> cannot be a descendant of <button>.
```

**原因：**
`TabBar.tsx` 中，tab 项使用 `<button>` 包裹，内部的关闭按钮也是 `<button>`，导致嵌套。

**修复：**
将外层 `<button>` 改为 `<div>` + `onClick`：

```tsx
// 修复前
<button onClick={() => switchTab(tab.id)}>
  <span>{tab.title}</span>
  <button onClick={closeTab}>×</button>
</button>

// 修复后
<div onClick={() => switchTab(tab.id)} className="cursor-pointer">
  <span>{tab.title}</span>
  <button onClick={closeTab}>×</button>
</div>
```

---

### 问题 2: Zustand 无限循环
**错误信息：**
```
Maximum update depth exceeded. This can happen when a component 
repeatedly calls setState inside componentWillUpdate or componentDidUpdate.
```

**原因：**
Zustand selector 直接在组件中使用 `.filter()` 和 `.sort()` 等数组方法：

```tsx
// ❌ 每次都创建新数组引用，触发重新渲染
const tabs = useTabsStore((s) => s.tabs.filter(t => t.status === "active"));
```

每次组件渲染都会创建新的数组引用，导致 React 认为状态变化 → 触发重新渲染 → 又创建新数组 → 无限循环。

**修复方案：**
使用 `useMemo` 缓存派生状态：

```tsx
// ✅ 只在 allTabs 变化时重新计算
const allTabs = useTabsStore((s) => s.tabs);
const tabs = useMemo(
  () => allTabs.filter((t) => t.status === "active"),
  [allTabs]
);
```

**修复文件：**
- `src/components/TabBar.tsx`
- `src/components/HistoryPanel.tsx`
- `src/App.tsx`

---

## 最佳实践

### Zustand Selector 规则

1. **简单值选择** - 直接返回
   ```tsx
   const activeTabId = useTabsStore((s) => s.activeTabId);
   ```

2. **派生状态** - 使用 useMemo
   ```tsx
   const allTabs = useTabsStore((s) => s.tabs);
   const activeTabs = useMemo(
     () => allTabs.filter(t => t.status === "active"),
     [allTabs]
   );
   ```

3. **Actions** - 直接选择函数
   ```tsx
   const createTab = useTabsStore((s) => s.createTab);
   ```

### 避免嵌套交互元素

HTML 规范禁止：
- `<button>` 内嵌套 `<button>`
- `<a>` 内嵌套 `<a>` 或 `<button>`
- 交互元素内嵌套其他交互元素

**解决方案：**
- 外层用 `<div>` + `onClick`
- 内层用实际的交互元素
- 内层元素用 `e.stopPropagation()` 阻止冒泡

---

## 验证

```bash
npm run build  # ✅ 编译成功
npm run dev    # ✅ 无警告，无错误
```

所有功能正常运行！
