import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

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


test('bundle manifest keeps the web profile bootable', () => {
  const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'))
  assert.equal(pkg.dsh.bundle.patch, './cordis.patch.yml')
  assert.equal(pkg.dsh.client.platform, 'web')
  assert.equal(pkg.dsh.client.immediately, true)
  assert.equal('inject' in pkg.dsh.client, false, 'do not hard-depend on UI packages absent from the web profile')
})
