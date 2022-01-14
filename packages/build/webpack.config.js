const {AngularWebpackLoaderPath, AngularWebpackPlugin} = require('@ngtools/webpack');
const {resolve} = require('path');
const {ScriptTarget} = require('typescript');
const {merge} = require('webpack-merge');
const TerserPlugin = require('terser-webpack-plugin');
const {SourceMapDevToolPlugin} = require('webpack');
const HtmlWebpackPlugin = require('html-webpack-plugin');

module.exports = async function (env) {
    const rootPath = resolve(__dirname, '../..');
    const options = {
        srcPath: resolve(rootPath, 'packages/site/src'),
        cachePath: resolve(rootPath, 'node_modules/.cache'),
        tsconfig: resolve(rootPath, 'packages/site/tsconfig.app.json'),
        distPath: resolve(rootPath, 'dist'),
        production: !!env.production,
    };

    const configs = await Promise.all([
        getEntryConfig(options),
        getCommonConfig(options),
        getSourceMapConfig(options),
        getAngularConfig(options),
        getMinifyConfig(options),
    ]);

    return merge(configs);
};

function getEntryConfig({srcPath}) {
    return {
        entry: {
            polyfills: resolve(srcPath, 'polyfills.ts'),
            main: resolve(srcPath, 'main.ts'),
        },
        plugins: [
            new HtmlWebpackPlugin({
                template: resolve(srcPath, 'index.html'),
            }),
        ],
    };
}

function getCommonConfig({production, distPath, srcPath}) {
    return {
        mode: production ? 'production' : 'development',
        resolve: {
            extensions: ['.ts', '.js'],
            mainFields: ['browser', 'module', 'main'],
            alias: {
                src: srcPath,
            }
        },
        node: false,
        target: ['web', 'es2015'],
        output: {
            path: distPath,
        },
        performance: {
            hints: 'warning',
            maxEntrypointSize: !production ? Infinity : 1024 * 2024,
            maxAssetSize: !production ? Infinity : 1024 * 2024,
        },
        optimization: {
            chunkIds: 'named',
            moduleIds: 'deterministic',
            splitChunks: {
                cacheGroups: {
                    // the default code reuse strategy is very good, but the chunk names are nondeterministic thus we can't reliably preload them
                    // via <script> tags from twig:
                    default: false,
                    defaultVendors: false,

                    // pull all node_modules from main.js into vendor.js
                    vendors: {
                        name: 'vendor',
                        test: /[\\/]node_modules[\\/]/,
                        priority: -10,
                        chunks: (chunk) => chunk.name === 'main',
                    },
                },
            },
        },
    };
}

function getSourceMapConfig({production}) {
    return {
        devtool: false,
        plugins: !production
            ? [
                // the options are from angular-cli - this enables:
                // 1. typescript & css sourcemaps in single build (for js you want eval for maximum build speed & for css inline, this handles both)
                // 2. source maps for component styles
                new SourceMapDevToolPlugin({
                    include: /\.(css|js)$/,
                    sourceRoot: 'webpack:///',
                    moduleFilenameTemplate: '[resource-path]',
                    append: undefined,
                }),
            ]
            : [],
    }
}

function getAngularConfig({srcPath, cachePath, tsconfig, production}) {
    return {
        module: {
            exprContextCritical: false,
            rules: [
                {
                    test: /[\/\\]@angular[\/\\]core[\/\\].+\.js$/,
                    parser: {
                        system: true,
                    },
                },
                {
                    test: /\.tsx?$/,
                    use: [AngularWebpackLoaderPath],
                },
                {
                    test: /\.[cm]?js$|\.tsx?$/,
                    // The below is needed due to a bug in `@babel/runtime`. See: https://github.com/babel/babel/issues/12824
                    resolve: {fullySpecified: false},
                    exclude: [/[\/\\](?:core-js|\@babel|tslib|web-animations-js)[\/\\]/],
                    enforce: 'post',
                    use: [
                        {
                            loader: require.resolve('./angular-devkit/babel/webpack-loader'),
                            options: {
                                cacheDirectory: (!production && resolve(cachePath, 'babel')) || false,
                                optimize: true,
                                scriptTarget: ScriptTarget.ES2015,
                            },
                        },
                    ],
                },
            ],
        },
        plugins: [
            new AngularWebpackPlugin({
                directTemplateLoading: true,
                emitNgModuleScope: !production,
                emitClassMetadata: !production,
                tsconfig,
                fileReplacements: {
                    [`${srcPath}/environment.ts`]: `${srcPath}/environment${production ? '.prod' : ''}.ts`,
                },
            }),
        ],
    }
}

async function getMinifyConfig({production}) {
    if (!production) {
        return {}
    }

    const angularCli = await import('@angular/compiler-cli');

    return {
        optimization: {
            minimizer: [
                new TerserPlugin({
                    parallel: true,
                    terserOptions: {
                        safari10: true,
                        compress: {
                            ecma: 5,
                            passes: 3,
                            // these globals set a few variables to `false`, allowing terser to remove parts of angular that are only run in dev mode
                            global_defs: angularCli.GLOBAL_DEFS_FOR_TERSER_WITH_AOT,
                            // @see https://github.com/angular/angular-cli/commit/fa8216c217bc8b744ef4d103c682b472c201ded9 - allows terser to remove getters if unused
                            pure_getters: true,
                            // @see https://github.com/angular/angular-cli/commit/c94a1961fc5b4f916e1c9fb3880efc800a797506 - allows terser to remove parts of angular if unused
                            pure_funcs: ['forwardRef'],
                        },
                        output: {
                            ecma: 5,
                            // terser added this and enabled by default, but angular & chrome devs say it's better to keep this disabled
                            // @see https://github.com/angular/angular/pull/39432#discussion_r512556210
                            // @see https://github.com/angular/angular-cli/commit/b45a2adba5eb7baadbfb828f577a03dfd153656d
                            wrap_func_args: false,
                        },
                    },
                }),
            ],
        },
    };
}
