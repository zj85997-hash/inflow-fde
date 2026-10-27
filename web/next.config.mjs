/** @type {import('next').NextConfig} */
const staticDemo = process.env.NEXT_PUBLIC_STATIC_DEMO === '1';
const basePath = process.env.NEXT_PUBLIC_BASE_PATH || '';

const nextConfig = {
  reactStrictMode: true,
  devIndicators: false,
  // 工作区包直接以 TS 源码发布，由 Next 编译
  transpilePackages: ['@inflow/core', '@inflow/gateway', '@inflow/contracts'],
  ...(staticDemo
    ? {
        // 在线演示：导出纯静态页面，接口在浏览器里由 @inflow/core 实现
        output: 'export',
        trailingSlash: true,
        images: { unoptimized: true },
      }
    : {}),
  ...(basePath ? { basePath } : {}),
};

export default nextConfig;
