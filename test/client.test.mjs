import test from 'node:test'
import assert from 'node:assert/strict'

const loaded = []
globalThis.window = {
  __ModuleLoader__: {
    load(definition) {
      loaded.push(definition)
    },
  },
}

const fakeReact = {
  createElement: (type, props, ...children) => ({ type, props, children }),
  useState: (value) => [typeof value === 'function' ? value() : value, () => {}],
  useEffect: () => {},
}

await import('../lib/client.js')

test('client module registers the Chinese row config page', () => {
  assert.equal(loaded.length, 1)
  const definition = loaded[0]
  assert.equal(definition.id, 'dsh-approval-alert')

  const api = definition.factory((name) => {
    if (name === 'react') return fakeReact
    throw new Error(`unexpected require: ${name}`)
  })
  assert.deepEqual(api.inject, ['slots'])
  assert.equal(typeof api.apply, 'function')

  let registration = null
  const ctx = {
    slots: {
      inject(name, factory) {
        assert.equal(name, 'plugins.row.config')
        factory()
      },
      register(options, component) {
        registration = { options, component }
        return () => {}
      },
    },
  }
  api.apply(ctx)

  assert.equal(registration.options.name, 'plugins.row.config')
  assert.equal(registration.options.key, 'dsh-approval-alert#approval-alert')
  assert.match(registration.component({ view: 'summary' }), /提示音/)
})
