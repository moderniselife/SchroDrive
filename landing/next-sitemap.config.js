/** @type {import('next-sitemap').IConfig} */
module.exports = {
  siteUrl: 'https://schrodrive.org',
  generateRobotsTxt: true,
  generateIndexSitemap: false,
  outDir: 'public',
  robotsTxtOptions: {
    policies: [
      { userAgent: '*', allow: '/' },
      { userAgent: '*', disallow: ['/api/*'] },
    ],
    additionalSitemaps: ['https://schrodrive.org/sitemap.xml'],
  },
  exclude: ['/api/*', '/_not-found'],
  transform: async (config, path) => ({
    loc: path,
    changefreq: path === '/' ? 'weekly' : 'monthly',
    priority: path === '/' ? 1.0 : path.startsWith('/docs') ? 0.9 : 0.7,
    lastmod: new Date().toISOString(),
    alternateRefs: [],
  }),
};
