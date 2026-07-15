const path = require('path');
const CopyPlugin = require('copy-webpack-plugin');

module.exports = {
    devtool: false,
    entry: path.resolve(__dirname, 'harness.ts'),
    mode: 'development',
    module: {
        rules: [{
            exclude: /node_modules/,
            test: /\.ts$/,
            use: [{
                loader: 'ts-loader',
                options: {
                    transpileOnly: true
                }
            }]
        }]
    },
    output: {
        clean: true,
        filename: 'harness.js',
        path: path.resolve(__dirname, '.harness')
    },
    plugins: [
        new CopyPlugin({
            patterns: [{
                from: path.resolve(__dirname, 'harness.html'),
                to: 'index.html'
            }]
        })
    ],
    resolve: {
        extensions: ['.ts', '.js']
    }
};
