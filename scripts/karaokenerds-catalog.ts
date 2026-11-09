/** Central-operator command. The URL/key is read from a private file, never arguments. */
import { existsSync, readFileSync } from 'node:fs';
import { isAbsolute } from 'node:path';
import { CommunityCatalogStore, fetchCommunity, validateCommunityUrl } from '../src/catalog/karaokenerds';
import { resolveSelectedBrand } from '../src/catalog/karaokenerds-public-client';
import { youtubeVideoId } from '../src/catalog/karaokenerds-brand-map';
import { downloadYtDlpVideo, inspectYtDlpVideo } from '../src/main/karaokenerds-ytdlp';
import { previewCatalogBatch } from '../src/main/karaokenerds-batch-catalog';

async function main(): Promise<void> {
  const database = process.env.TPV_KARAOKENNERDS_DATABASE;
  const operation = process.argv[2];
  if (!database || !isAbsolute(database) || !['seed', 'refresh', 'status', 'map-brand', 'brands', 'tracks', 'set-track-code', 'inspect-video', 'download', 'preview-batch', 'sqlite-refresh-status', 'sqlite-refresh-retire', 'sqlite-refresh-recover-stale', 'sqlite-refresh-resume'].includes(operation) || process.argv.length !== 3)
    throw new Error('Invalid configuration.');
  if (operation !== 'seed' && !existsSync(database)) throw new Error('Catalog database is missing.');
  const store = new CommunityCatalogStore(database);
  try {
    if (operation === 'seed') {
      const snapshot = process.env.TPV_KARAOKENNERDS_INITIAL_SNAPSHOT;
      if (!snapshot || !isAbsolute(snapshot)) throw new Error('Invalid configuration.');
      store.seed(JSON.parse(readFileSync(snapshot, 'utf8')), Date.now());
      console.log(JSON.stringify({ status: 'seeded', records: store.read()?.Items.length }));
    } else if (operation === 'refresh') {
      if (store.sqliteRefreshStatus().state === 'retired') {
        console.error('SQLite refresh is retired. Use the central catalog updater.'); process.exitCode = 1; return;
      }
      const file = process.env.TPV_KARAOKENNERDS_CREDENTIAL_FILE;
      if (!file || !isAbsolute(file)) throw new Error('Invalid configuration.');
      const url = readFileSync(file, 'utf8').trim();
      validateCommunityUrl(url);
      const result = await store.refresh(() => fetchCommunity(url));
      console.log(JSON.stringify(result));
      if (result.status === 'retired') console.error('SQLite refresh is retired. Use the central catalog updater.');
      if (result.status === 'in-progress') console.error('An earlier SQLite refresh is still outstanding; stop the updater before explicit recovery.');
      if (result.status === 'failed' || result.status === 'not-initialized' || result.status === 'in-progress' || result.status === 'retired') process.exitCode = 1;
    } else if (operation === 'sqlite-refresh-status') {
      console.log(JSON.stringify(store.sqliteRefreshStatus()));
    } else if (operation === 'sqlite-refresh-retire') {
      console.log(JSON.stringify(store.retireSQLiteRefresh(process.env.TPV_KARAOKENNERDS_CONFIRMED_STOPPED === 'true')));
    } else if (operation === 'sqlite-refresh-recover-stale') {
      console.log(JSON.stringify(store.recoverStaleSQLiteAttempt(process.env.TPV_KARAOKENNERDS_CONFIRMED_STOPPED === 'true')));
    } else if (operation === 'sqlite-refresh-resume') {
      const value = process.env.TPV_KARAOKENNERDS_CENTRAL_LAST_ATTEMPT;
      if (!value || !/^\d{1,16}$/.test(value)) throw new Error('Stop the central updater and provide its last attempt time.');
      console.log(JSON.stringify(store.resumeSQLiteRefresh(process.env.TPV_KARAOKENNERDS_CONFIRMED_STOPPED === 'true', Number(value))));
    } else if (operation === 'map-brand') {
      const slug = process.env.TPV_KARAOKENNERDS_BRAND_SLUG, catalog = store.read();
      if (!slug || !catalog) throw new Error('Missing brand or catalog.');
      const { mapping: result, matchedVideoIds } = await resolveSelectedBrand(slug, catalog);
      if (result.status === 'resolved') {
        store.saveBrandMapping(result, Date.now(), matchedVideoIds);
        console.log(JSON.stringify({ status: result.status, slug: result.slug, name: result.name, matchedVideos: result.matchedVideos, unmatchedVideos: result.unmatchedVideos }));
      } else {
        console.log(JSON.stringify(result)); process.exitCode = 1;
      }
    } else if (operation === 'set-track-code') {
      const video = process.env.TPV_KARAOKENNERDS_VIDEO_ID, code = process.env.TPV_KARAOKENNERDS_TRACK_CODE, source = process.env.TPV_KARAOKENNERDS_CODE_SOURCE;
      if (!video || !code || (source !== 'host-confirmed' && source !== 'creator-catalog')) throw new Error('Missing track metadata.');
      store.saveProducerTrackCode(video, code, source);
      console.log(JSON.stringify({ status: 'saved' }));
    } else if (operation === 'inspect-video') {
      const video = process.env.TPV_KARAOKENNERDS_VIDEO_ID, executable = process.env.TPV_YTDLP_EXECUTABLE;
      if (!video || !executable || !store.videoMetadata().some(item => item.youtubeId === video)) throw new Error('Unknown video.');
      const dates = await inspectYtDlpVideo(executable, `https://youtu.be/${video}`);
      store.saveVideoDates(video, dates);
      console.log(JSON.stringify(dates));
    } else if (operation === 'download') {
      const slug = process.env.TPV_KARAOKENNERDS_BRAND_SLUG, video = process.env.TPV_KARAOKENNERDS_VIDEO_ID;
      const executable = process.env.TPV_YTDLP_EXECUTABLE, baseDirectory = process.env.TPV_CACHED_VIDEOS_DIR;
      const catalog = store.read(), brand = store.brandMappings().find(item => item.slug === slug);
      if (!catalog || !brand || !video || !executable || !baseDirectory || !store.videoMetadata().some(item => item.youtubeId === video && item.brandSlug === slug)) throw new Error('Unknown video.');
      const matches = catalog.Items.filter(item => item.Brand === brand.upstreamBrand && youtubeVideoId(item.Watch) === video);
      if (matches.length !== 1) throw new Error('Video metadata is ambiguous.');
      const song = matches[0];
      try {
        const result = await downloadYtDlpVideo({ executable, watchUrl: song.Watch, baseDirectory,
          video: { id: video, provider: 'karaokenerds', brandSlug: brand.slug, artist: song.Artist, title: song.Title, extension: 'mp4' } });
        console.log(JSON.stringify(result));
      } catch {
        console.error('Video download failed. Check for an active ffmpeg process and any .tpv-yt- staging directory before retrying.');
        process.exitCode = 1;
      }
    } else if (operation === 'preview-batch') {
      const baseDirectory = process.env.TPV_CACHED_VIDEOS_DIR;
      if (!baseDirectory || !isAbsolute(baseDirectory)) throw new Error('Invalid cache directory.');
      const lines = (value: string | undefined) => (value ?? '').split(/\r?\n/).map(item => item.trim()).filter(Boolean);
      const preview = previewCatalogBatch(store, baseDirectory, {
        brandSlugs: lines(process.env.TPV_KARAOKENNERDS_BATCH_BRANDS), artists: lines(process.env.TPV_KARAOKENNERDS_BATCH_ARTISTS),
      });
      console.log(JSON.stringify(preview));
    } else if (operation === 'brands') {
      console.log(JSON.stringify({ brands: store.brandMappings().map(({ slug, name, upstreamBrand: brandCode, observedAt }) => ({ slug, name, brandCode, observedAt })) }));
    } else if (operation === 'tracks') {
      const slug = process.env.TPV_KARAOKENNERDS_BRAND_SLUG, catalog = store.read();
      const brand = store.brandMappings().find(item => item.slug === slug);
      if (!brand || !catalog) throw new Error('Brand is not mapped.');
      const metadata = new Map(store.videoMetadata().filter(item => item.brandSlug === slug).map(item => [item.youtubeId, item]));
      const tracks = catalog.Items.flatMap(item => {
        const id = youtubeVideoId(item.Watch), known = id ? metadata.get(id) : undefined;
        return item.Brand === brand.upstreamBrand && known ? [{ artist: item.Artist, title: item.Title, youtubeId: id,
          producerTrackCode: known.producerTrackCode, codeSource: known.codeSource, catalogCreated: item.Created, videoDates: store.videoDates(known.youtubeId) }] : [];
      });
      console.log(JSON.stringify({ slug: brand.slug, tracks }));
    } else {
      const catalog = store.read();
      console.log(JSON.stringify({ status: catalog ? 'available' : 'not-initialized', records: catalog?.Items.length ?? 0, ...store.status() }));
    }
  } finally { store.close(); }
}

main().catch((error: unknown) => {
  const safe = new Set(['Stop all old updaters and confirm the cutover.', 'Stop all old updaters and confirm recovery.',
    'Stop the central updater and provide its last attempt time.', 'SQLite catalog is not initialized.',
    'An earlier SQLite attempt needs explicit recovery.', 'No recoverable SQLite attempt exists.',
    'SQLite refresh is not in a recoverable retired state.', 'Invalid SQLite refresh retirement marker.']);
  console.error(error instanceof Error && safe.has(error.message) ? error.message : 'Catalog operation failed; check the private configuration and database.');
  process.exitCode = 1;
});
