/** Export a stopped local catalog privately for a one-time central migration. */
import { CatalogExportCleanupError, exportSQLiteCatalog, writeCatalogMigrationExport } from '../src/catalog/karaokenerds-sqlite-export';

try {
  const database = process.env.TPV_KARAOKENNERDS_DATABASE;
  const destination = process.env.TPV_KARAOKENNERDS_EXPORT;
  if (!database || !destination || process.argv.length !== 2) throw new Error('Invalid configuration.');
  const bundle = exportSQLiteCatalog(database);
  writeCatalogMigrationExport(bundle, destination);
  console.log(JSON.stringify({ status: 'exported', integrity: bundle.integrity }));
} catch (error) {
  if (error instanceof CatalogExportCleanupError) console.error(JSON.stringify({ status: 'cleanup-needed', published: error.published }));
  else console.error('Catalog export failed. Confirm SQLite refresh is retired with no outstanding attempt; check the private paths, destination and catalog integrity.');
  process.exitCode = 1;
}
