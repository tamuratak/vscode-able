module.exports = /** @type { import('webpack').Configuration } */ ({
    entry: './webview/jupyterlite_kernel/index.ts',
    devtool: 'source-map',
    module: {
      rules: [
        {
          test: /pypi\/.*/,
          type: 'asset/resource',
          generator: {
            filename: 'pypi/[name][ext][query]',
          },
        },
        {
          test: /schema\/.*/,
          type: 'asset/resource',
          generator: {
            filename: 'schema/[name][ext][query]',
          },
        },
      ],
    },
  });