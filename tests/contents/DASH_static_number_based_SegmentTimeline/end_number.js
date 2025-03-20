const BASE_URL =
  "http://" +
  __TEST_CONTENT_SERVER__.URL +
  ":" +
  __TEST_CONTENT_SERVER__.PORT +
  "/DASH_static_number_based_SegmentTimeline/media/";

export default {
  url: BASE_URL + "end_number.mpd",
  transport: "dash",
  isDynamic: false,
  isLive: false,

  // TODO ...
};
