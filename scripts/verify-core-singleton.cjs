const core = require('activitylog-core');
const nestjs = require('activitylog-nestjs');
const typeorm = require('activitylog-nestjs/typeorm');
const nextjs = require('activitylog-nextjs');
const prisma = require('activitylog-nextjs/prisma');
const drizzle = require('activitylog-nextjs/drizzle');

const expected = core.activityLogContextStorage;
const imports = { nestjs, typeorm, nextjs, prisma, drizzle };

for (const [name, mod] of Object.entries(imports)) {
  if (mod.activityLogContextStorage !== expected) {
    throw new Error(`activitylog-core singleton was duplicated for ${name}`);
  }
}

console.log('activitylog-core singleton verified across built packages');
