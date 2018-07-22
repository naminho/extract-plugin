module.exports = {
  root: true,
  plugins: ['prettier'],
  extends: ['@webpack-contrib/eslint-config-webpack'],
  rules: {
    'prettier/prettier': [
      'error'
    ],
    'class-methods-use-this': 'off',
    'no-undefined': 'off',
    'semi': 0
  }
}
