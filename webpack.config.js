const path = require('path');
const HtmlWebpackPlugin = require('html-webpack-plugin');
const CopyWebpackPlugin = require('copy-webpack-plugin');

module.exports = {
  entry: {
    BitmovinCafReceiver: './src/index.ts',
  },
  resolve: {
    extensions: ['.ts', '.js'],
  },
  output: {
    path: path.resolve(__dirname, 'dist'),
    filename: '[name].js',
    library: 'BitmovinCafReceiver',
    libraryExport: 'default'
  },
  devtool: 'source-map',
  module: {
    rules: [
      {
        test: /\.ts?$/,
        use: 'ts-loader',
        exclude: /node_modules/,
      }
    ],
  },
  plugins: [
    new CopyWebpackPlugin([
      { from: 'src/styles/receiver.css', to: 'styles' },
      { from: 'src/images', to: 'images' }
    ]),
    new HtmlWebpackPlugin({
      hash: true,
      inject: 'head',
      template: './src/index.html',
    })
  ],
};
