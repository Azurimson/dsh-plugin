// client/client.js — DSH 设置页「记忆」分区（lazy-CJS 客户端半）
// 参考 dsh-notify-say：向 settings.section 槽注册一个设置页分区，
// 数据通过宿主 webServer 上的 /api/dsh-human-memory 路由读取。
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

    function layerLabel(l) {
      return LAYER_LABEL[l] || l;
    }

    function fmt(ts) {
      if (!ts) return '未知时间';
      var d = new Date(ts);
      function p(n) { return String(n).padStart(2, '0'); }
      return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate()) + ' ' + p(d.getHours()) + ':' + p(d.getMinutes());
    }

    var styles = {
      wrap: { display: 'flex', flexDirection: 'column', gap: '10px', padding: '4px 0' },
      bar: { display: 'flex', flexWrap: 'wrap', gap: '8px', alignItems: 'center' },
      btn: {
        cursor: 'pointer', border: '1px solid #2f3946', background: '#1d242d', color: '#e6e8eb',
        padding: '6px 12px', borderRadius: '8px', fontSize: '13px',
      },
      btnPrimary: {
        cursor: 'pointer', border: '1px solid #1f6feb', background: '#1f6feb', color: '#fff',
        padding: '6px 12px', borderRadius: '8px', fontSize: '13px',
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
    };

    function MemorySection() {
      var st = React.useState(null);
      var items = st[0];
      var setItems = st[1];
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

      // 删除：立即从界面移除（不做确认），后端软删除进删除缓冲区，下次巩固时真正删除
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

      var list = items || [];
      var sorted = list.slice().sort(function (a, b) {
        return (b.importance || 0) - (a.importance || 0);
      });

      return h(
        'div',
        { style: styles.wrap },
        h(
          'div',
          { style: styles.bar },
          h('button', { style: styles.btnPrimary, onClick: openFolder }, '打开记忆文件夹'),
          h('button', { style: styles.btn, onClick: load }, '刷新'),
          h('span', { style: styles.muted }, items === null ? '加载中…' : '共 ' + sorted.length + ' 条（按权重排序）'),
        ),
        error ? h('div', { style: styles.err }, '加载失败：' + error) : null,
        sorted.length === 0 && items !== null
          ? h('div', { style: styles.muted }, '暂无记忆。')
          : sorted.map(function (m) {
              return h(
                'div',
                { key: m.id, style: styles.item },
                h(
                  'div',
                  { style: styles.top },
                  h('span', { style: styles.badge }, layerLabel(m.layer)),
                  m.kind === 'turn' ? h('span', { style: styles.badge }, '行为') : null,
                  m.kind === 'tool' ? h('span', { style: styles.badge }, '操作') : null,
                  h('span', null, fmt(m.occurredAt)),
                  m.sessionId ? h('span', null, '会话 ' + String(m.sessionId).slice(0, 8)) : null,
                  h(
                    'button',
                    {
                      style: styles.btnDanger,
                      title: '删除（立即从列表移除；下次巩固时真正删除）',
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
