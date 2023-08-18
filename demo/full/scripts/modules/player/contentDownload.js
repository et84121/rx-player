/* eslint-disable no-console */
import ContentDownloader from "../../../../../src/experimental/tools/ContentDownloader";


const EXAMPLE_SONG = {
  MANIFEST_URL:
    "https://storageaccountqualib4aa.blob.core.windows.net/testaudio/test-for-cbcs/master.mpd",
  LICENSE_URL: "https://drm-kkbox-license.qp.kkbox-testing.com.tw/license",
};

const STORAGE_KEY = "contentIds";

const contentDownloader = new ContentDownloader();


const CHUNK_SIZE = 30;

const INTERVAL_BETWEEN_RENEW_JOBS = 1000 * 15;

async function reproduceError() {
  console.log("start reproduce error");

  await contentDownloader.initialize();

  // download a lot of songs
  const contendIds = await downloadSongs();

  // renew license with large number of concurrent jobs
  setInterval(()=>{
    console.log("renewal songs");
    renewSongs(contendIds);
  },INTERVAL_BETWEEN_RENEW_JOBS);
}

/**
 *
 * @param {string[]} contendIds
 */
async function renewSongs(contendIds){
  const pendingRenewJobs = chunk(contendIds, CHUNK_SIZE)
    .map((groupIds) =>
      groupIds.map((id) => renewLicense(id))
    );

  for (const group of pendingRenewJobs){
    await Promise.all(group);
  }
}


/**
 * download or restore songs
 * @returns {string[]}
 */
async function downloadSongs() {
  const restoreItems = localStorage.getItem(STORAGE_KEY);
  if (restoreItems !== null) {
    console.log("skip download");
    return JSON.parse(restoreItems);
  }

  const contendIds = [];

  for (let i=0;i<6;i++){
    const jobs = Array.from({length:10},downloadSong);
    const groupIds = await Promise.all(jobs);
    contendIds.push(...groupIds);
  }

  localStorage.setItem(STORAGE_KEY,JSON.stringify(contendIds));
  return contendIds;
}


function downloadSong() {
  return new Promise((resolve, reject)=>{
    const contentId = contentDownloader.download({
      url: EXAMPLE_SONG["MANIFEST_URL"],
      transport: "dash",
      onError: (err) => {
        console.error(err);
        reject(err);
      },
      keySystems: {
        type: "com.widevine.alpha",
        getLicense,
      },
      onFinished:()=>{
        console.info(`finish downoload song  ${contentId}`);
        resolve(contentId);
      },
      onProgress:(evt)=>{
        console.log(`download song ${contentId}, progress ${evt.progress}, size ${evt.size}`);
      },
    });
  });
}

async function renewLicense(contentId) {
  await contentDownloader.renewalContentLicense(contentId, {
    type: "com.widevine.alpha",
    getLicense,
  });

  console.info(`renewal song license ${contentId}`);
}

/**
 * Get License
 * @param {ArrayBuffer} challenge
 * @returns {Promise<ArrayBuffer>}
 */
async function getLicense(challenge) {
  const LicenseServerURL = EXAMPLE_SONG["LICENSE_URL"];

  const request = await fetch(LicenseServerURL, {
    body: challenge,
    method: "POST",
  });

  const response = await request.arrayBuffer();

  return response;
}

/**
 *
 * @param {Array} array
 * @param {number} size
 * @returns {Array<Array>}
 */
function chunk(array, size) {
  const result = [];
  for (let i = 0; i < array.length; i += size) {
    result.push(array.slice(i, i + size));
  }
  return result;
}

export { reproduceError };
