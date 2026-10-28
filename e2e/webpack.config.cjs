const path = require('path');
const CopyPlugin = require('copy-webpack-plugin');
const { DefinePlugin } = require('webpack');

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
        }, {
            test: /\.scss$/,
            use: ['style-loader', 'css-loader', 'sass-loader']
        }]
    },
    output: {
        clean: true,
        filename: 'harness.js',
        path: path.resolve(__dirname, '.harness')
    },
    plugins: [
        new DefinePlugin({
            __COMMIT_SHA__: JSON.stringify('aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'),
            __PTV_BUILD_DATE__: JSON.stringify('2026-01-01T00:00:00.000Z'),
            __PTV_BUILD_ID__: JSON.stringify('ptv-e2e-current'),
            __PTV_VERSION__: JSON.stringify('0.0.1')
        }),
        new CopyPlugin({
            patterns: [{
                from: path.resolve(__dirname, 'harness.html'),
                to: 'index.html'
            }]
        })
    ],
    resolve: {
        alias: {
            [path.resolve(__dirname, '../src/ptv/shell/routeController')]:
                path.resolve(__dirname, 'tvFocusRouteControllerStub.ts')
        },
        extensions: ['.ts', '.js']
    }
};
