// client/client.js — DSH 设置页「记忆」分区（lazy-CJS 客户端半）
// 顶部一排文件夹按钮（全部 / 工作 / 情节 / 语义 / 核心 / 回收站），点击后显示对应记忆；
// 右上角排序按钮：按权重（默认，从大到小）或按时间（新到旧）。
window.__ModuleLoader__.load({
  id: 'dsh-human-memory',
  factory: (require) => {
    var module = { exports: {} };
    var exports = module.exports;

    var React = require('react');
    var h = React.createElement;

    var name = 'dsh-human-memory';
    var inject = ['slots'];

    var ROUTE_PREFIX = 'dsh-human-memory';

    /** 用 document.baseURI 解析路由，兼容反向代理子路径。 */
    function apiUrl(path) {
      try {
        return new URL('api/' + ROUTE_PREFIX + '/' + path, document.baseURI).toString();
      } catch (e) {
        return '/api/' + ROUTE_PREFIX + '/' + path;
      }
    }

    var LAYER_LABEL = { working: '工作', episodic: '情节', semantic: '语义', core: '核心' };
    var FOLDERS = [
      { id: 'all', label: '全部' },
      { id: 'working', label: '工作' },
      { id: 'episodic', label: '情节' },
      { id: 'semantic', label: '语义' },
      { id: 'core', label: '核心' },
      { id: 'trash', label: '回收站' },
    ];

    function layerLabel(l) {
      return LAYER_LABEL[l] || l || '未知';
    }

    function fmt(ts) {
      if (!ts) return '未知时间';
      var d = new Date(ts);
      function p(n) { return String(n).padStart(2, '0'); }
      return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate()) + ' ' + p(d.getHours()) + ':' + p(d.getMinutes());
    }

    var styles = {
      wrap: { display: 'flex', flexDirection: 'column', gap: '10px', padding: '4px 0' },
      topBar: { display: 'flex', flexWrap: 'wrap', gap: '8px', alignItems: 'center', justifyContent: 'space-between' },
      tabs: { display: 'flex', flexWrap: 'wrap', gap: '6px' },
      actions: { display: 'flex', flexWrap: 'wrap', gap: '6px', marginLeft: 'auto', alignItems: 'center' },
      tab: {
        cursor: 'pointer', border: '1px solid #2f3946', background: '#1d242d', color: '#e6e8eb',
        padding: '5px 10px', borderRadius: '999px', fontSize: '12px',
      },
      tabActive: {
        cursor: 'pointer', border: '1px solid #1f6feb', background: '#1f6feb', color: '#fff',
        padding: '5px 10px', borderRadius: '999px', fontSize: '12px',
      },
      btn: {
        cursor: 'pointer', border: '1px solid #2f3946', background: '#1d242d', color: '#e6e8eb',
        padding: '4px 9px', borderRadius: '7px', fontSize: '12px',
      },
      btnActive: {
        cursor: 'pointer', border: '1px solid #2c5a3f', background: '#16311f', color: '#7ee2a8',
        padding: '4px 9px', borderRadius: '7px', fontSize: '12px',
      },
      btnPrimary: {
        cursor: 'pointer', border: '1px solid #1f6feb', background: '#1f6feb', color: '#fff',
        padding: '4px 9px', borderRadius: '7px', fontSize: '12px',
      },
      muted: { color: '#8b96a5', fontSize: '12px' },
      item: { border: '1px solid #232a33', borderRadius: '10px', padding: '10px 12px' },
      top: { display: 'flex', flexWrap: 'wrap', gap: '8px', alignItems: 'center', fontSize: '12px', color: '#8b96a5', marginBottom: '4px' },
      badge: { padding: '1px 8px', borderRadius: '999px', border: '1px solid #2f3946', fontSize: '11px' },
      content: { whiteSpace: 'pre-wrap', wordBreak: 'break-word', fontSize: '13px' },
      err: { color: '#ff8f8f', fontSize: '12px' },
      btnDanger: {
        cursor: 'pointer', border: '1px solid #5a2b2b', background: '#2a1a1a', color: '#ff9a9a',
        padding: '2px 8px', borderRadius: '6px', fontSize: '12px', marginLeft: 'auto',
      },
      btnRestore: {
        cursor: 'pointer', border: '1px solid #2c5a3f', background: '#16311f', color: '#7ee2a8',
        padding: '2px 8px', borderRadius: '6px', fontSize: '12px', marginLeft: 'auto',
      },
    };

    function MemorySection() {
      var ist = React.useState(null);
      var items = ist[0];
      var setItems = ist[1];

      var tst = React.useState([]);
      var trash = tst[0];
      var setTrash = tst[1];

      var fst = React.useState('all');
      var folder = fst[0];
      var setFolder = fst[1];

      var sst = React.useState('importance');
      var sort = sst[0];
      var setSort = sst[1];

      var est = React.useState('');
      var error = est[0];
      var setError = est[1];

      var load = React.useCallback(function () {
        fetch(apiUrl('memories'))
          .then(function (r) {
            if (!r.ok) throw new Error('HTTP ' + r.status);
            return r.json();
          })
          .then(function (data) {
            setItems((data && data.memories) || []);
            setError('');
          })
          .catch(function (e) {
            setError(String((e && e.message) || e));
          });
        fetch(apiUrl('trash'))
          .then(function (r) {
            if (!r.ok) return { memories: [] };
            return r.json();
          })
          .then(function (data) {
            setTrash((data && data.memories) || []);
          })
          .catch(function () {});
      }, []);

      React.useEffect(function () {
        load();
      }, [load]);

      var openFolder = function () {
        fetch(apiUrl('open-folder'), {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: '{}',
        }).catch(function () {});
      };

      // 删除 = 移入回收站；立即从当前列表移除
      var remove = function (id) {
        setItems(function (prev) {
          return (prev || []).filter(function (m) { return m.id !== id; });
        });
        fetch(apiUrl('delete'), {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ id: id }),
        }).catch(function () {});
      };

      // 从回收站恢复
      var restore = function (id) {
        setTrash(function (prev) {
          return (prev || []).filter(function (m) { return m.id !== id; });
        });
        fetch(apiUrl('restore'), {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ id: id }),
        }).catch(function () {});
      };

      var current = folder === 'trash'
        ? trash
        : (folder === 'all'
          ? (items || [])
          : (items || []).filter(function (m) { return m.layer === folder; }));

      var sorted = current.slice().sort(function (a, b) {
        if (sort === 'time') return (b.occurredAt || 0) - (a.occurredAt || 0);
        return (b.importance || 0) - (a.importance || 0);
      });

      var counts = {
        all: (items || []).length,
        working: (items || []).filter(function (m) { return m.layer === 'working'; }).length,
        episodic: (items || []).filter(function (m) { return m.layer === 'episodic'; }).length,
        semantic: (items || []).filter(function (m) { return m.layer === 'semantic'; }).length,
        core: (items || []).filter(function (m) { return m.layer === 'core'; }).length,
        trash: (trash || []).length,
      };

      return h(
        'div',
        { style: styles.wrap },

        // ---------- 顶部：文件夹按钮（左） + 排序/操作（右） ----------
        h(
          'div',
          { style: styles.topBar },
          h(
            'div',
            { style: styles.tabs },
            FOLDERS.map(function (f) {
              var active = folder === f.id;
              return h(
                'button',
                {
                  key: f.id,
                  style: active ? styles.tabActive : styles.tab,
                  onClick: function () { setFolder(f.id); },
                },
                f.label + ' (' + counts[f.id] + ')',
              );
            }),
          ),
          h(
            'div',
            { style: styles.actions },
            h(
              'button',
              {
                style: sort === 'importance' ? styles.btnActive : styles.btn,
                title: '按权重从大到小',
                onClick: function () { setSort('importance'); },
              },
              '权重↓',
            ),
            h(
              'button',
              {
                style: sort === 'time' ? styles.btnActive : styles.btn,
                title: '按时间从新到旧',
                onClick: function () { setSort('time'); },
              },
              '时间↓',
            ),
            h('button', { style: styles.btn, onClick: load }, '刷新'),
            h('button', { style: styles.btnPrimary, onClick: openFolder }, '打开记忆文件夹'),
          ),
        ),

        error ? h('div', { style: styles.err }, '加载失败：' + error) : null,

        // ---------- 列表 ----------
        items === null
          ? h('div', { style: styles.muted }, '加载中…')
          : sorted.length === 0
            ? h('div', { style: styles.muted }, '该文件夹暂无记忆。')
            : sorted.map(function (m) {
                var isTrash = folder === 'trash';
                return h(
                  'div',
                  { key: m.id, style: styles.item },
                  h(
                    'div',
                    { style: styles.top },
                    h('span', { style: styles.badge }, layerLabel(m.layer)),
                    m.kind === 'turn' ? h('span', { style: styles.badge }, '行为') : null,
                    m.kind === 'tool' ? h('span', { style: styles.badge }, '操作') : null,
                    isTrash ? h('span', { style: styles.badge }, '已删除') : null,
                    h('span', null, fmt(m.occurredAt)),
                    m.sessionId ? h('span', null, '会话 ' + String(m.sessionId).slice(0, 8)) : null,
                    isTrash
                      ? h(
                          'button',
                          {
                            style: styles.btnRestore,
                            title: '从回收站恢复',
                            onClick: function () { restore(m.id); },
                          },
                          '恢复',
                        )
                      : h(
                          'button',
                          {
                            style: styles.btnDanger,
                            title: '删除（移入回收站，下次巩固时真正删除）',
                            onClick: function () { remove(m.id); },
                          },
                          '删除',
                        ),
                  ),
                  h('div', { style: styles.content }, m.content),
                );
              }),
      );
    }

    /** 向设置页注册「记忆」分区；失败只降级，不影响插件其它能力。 */
    function registerSettingsSection(ctx) {
      try {
        var slots = ctx.get('slots', false);
        if (!slots || typeof slots.inject !== 'function' || typeof slots.register !== 'function') {
          console.warn('[dsh-human-memory] slots 不可用，设置页分区未注册');
          return null;
        }
        var dispose = null;
        slots.inject('settings.section', function () {
          try {
            var d = slots.register(
              { name: 'settings.section', id: name, order: 70, label: '记忆' },
              MemorySection,
            );
            if (typeof d === 'function') dispose = d;
          } catch (e) {
            console.warn('[dsh-human-memory] 注册设置分区失败：', e);
          }
        });
        return function () {
          try {
            if (typeof dispose === 'function') dispose();
          } catch (e) {
            /* ignore */
          }
        };
      } catch (e) {
        return null;
      }
    }

    function apply(ctx) {
      return registerSettingsSection(ctx);
    }

    exports.apply = apply;
    exports.inject = inject;
    exports.name = name;
    return module.exports;
  },
});
