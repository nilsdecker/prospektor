// The catalogues a Netlify function can reach (#114).
//
// One literal `require` per language, on purpose. `lib/i18n.js` reads the
// catalogues from `src/_data/strings/` by path, which is right for the build
// and wrong for a function: the bundler ships what it can see a `require`
// for, and a directory read at runtime is not that. A language that lands in
// `src/_data/strings/` and not here is a welcome email that silently stays
// English — so `test/i18n.test.js` fails by name when the two lists differ.
module.exports = {
  es: require('../../src/_data/strings/es.json'),
};
