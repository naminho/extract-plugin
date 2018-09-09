const ExtractPlugin = require('../../');

module.exports = {
  mode: 'development',
  output: {
    chunkFilename: "[contenthash].js",
    publicPath: '/dist/'
  },
  module: {
    rules: [
      {
        test: /\.css$/,
        use: [
          ExtractPlugin.loader,
          'raw-loader'
        ]
      }
    ]
  },
  plugins: [
    new ExtractPlugin({
      filename: '[name].properties'
    })
  ],
  devServer: {
    contentBase: __dirname
  }
}
