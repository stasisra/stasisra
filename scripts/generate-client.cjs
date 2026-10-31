// Uses the pinned Prisma generator directly; engineType=client needs only bundled WASM.
const { getGenerators } = require("@prisma/internals");
(async () => {
  let generators = [];
  try {
    generators = await getGenerators({
      schemaPath: require("node:path").resolve("prisma/schema.prisma"),
      registry: {
        "prisma-client-js": {
          type: "rpc",
          generatorPath: require.resolve("@prisma/client/generator-build"),
          isNode: true,
        },
      },
    });
    for (const g of generators) await g.generate();
    console.log("Prisma SQLite JS client generated");
  } finally {
    for (const g of generators) g.stop();
  }
})().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
