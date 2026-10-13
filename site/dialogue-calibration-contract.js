// Explicit suen-approved amendment. The failed original operation remains immutable.
export const CALIBRATION_CONTRACT=Object.freeze({
 operation:'yw-dialogue-real-calibration-20261012-v1-amendment-3',
 action:'calibration_amendment3', priorOperation:'yw-dialogue-real-calibration-20261012-v1',
 priorCase:'language-er-independent', priorState:'review', priorReason:'missing_criterion',
 priorAccountedMicros:4678, priorReservedMicros:84000,
 priorCreatedAt:'2026-10-12T15:03:35.502Z', priorFinishedAt:'2026-10-12T15:03:39.337Z',
 priorUsage:Object.freeze({promptTokenCount:5097,candidatesTokenCount:228,totalTokenCount:5325}),
 priorPromptDigest:'6d8f6bc2e43b52bf1c91d1977c7a9d06e1d620029f6ddb99e91ee04955f60736',
 priorSourceDigest:'031bbb31c37efa51407a7069c310a7c51bff1ebbae982ab38fdacc69a6bf6f89',
 priorPacketDigest:'95b8f943e519191aba697a0c01984621ee8ea12549e164379363f5ef54a04f09',
 packetDigest:'4fb2ac792516d95c00022ad08bda42063e8606bec4989b3d46bc6b86c6a67317',
 maxTotalAttempts:30, additionalAttempts:26, maxRecoveries:2, maxCumulativeReservedMicros:2520000,
 windowMs:3600000, retries:0, hardExpiry:'2026-10-13T12:00:00Z',
 secondPrior: Object.freeze({operation:'yw-dialogue-real-calibration-20261012-v1-amendment-1', caseId:'language-er-independent', state:'review', reason:'gateway_unavailable', accountedMicros:null, reservedMicros:84000, createdAt:'2026-10-12T15:44:56.122Z', finishedAt:'2026-10-12T15:44:58.642Z', sourceDigest:'031bbb31c37efa51407a7069c310a7c51bff1ebbae982ab38fdacc69a6bf6f89', promptDigest:'f7701e2ce6677f34cebad1c576bce12336291c9250e8b6a726a9f59b510cb3f1', packetDigest:'887a2537d2069ed0bd0a1fdcc327c71862d5eac74b91feea59b538da4e549f8e'}),
 thirdPriors: Object.freeze([{"operation":"yw-dialogue-real-calibration-20261012-v1-amendment-2","attempt":1,"caseId":"language-er-independent","sourceDigest":"b079f0af0a3978ea0ac81c512a186211c5bee8a333c53d0b41f761f1ad9561fa","promptDigest":"caecd0124e90dfc38c7b092dcf5ad60103c05394010b818dd3bd0ab1528ea459","packetDigest":"4fb2ac792516d95c00022ad08bda42063e8606bec4989b3d46bc6b86c6a67317","receiptDigest":"98df8ec9f3af4e92c280d39ef73ae166abf811809529d47f69ccf1c2196c2a39","accounted_micros":null,"created_at":"2026-10-12T22:01:33.062Z","finished_at":"2026-10-12T22:01:36.643Z","reserved_micros":84000,"state":"review","usage_json":null},{"operation":"yw-dialogue-real-calibration-20261012-v1-amendment-2","attempt":2,"caseId":"language-er-misconception","sourceDigest":"b079f0af0a3978ea0ac81c512a186211c5bee8a333c53d0b41f761f1ad9561fa","promptDigest":"d8366012e18b24be22fa981e9d839817cdfcd5be6ec34b03c094962483480ea8","packetDigest":"4fb2ac792516d95c00022ad08bda42063e8606bec4989b3d46bc6b86c6a67317","receiptDigest":"7404cde7868c7dfc22ec29da7e1964b8eb5dcce79d86773f52c47d28bb6fe665","accounted_micros":null,"created_at":"2026-10-12T22:03:50.535Z","finished_at":"2026-10-12T22:03:52.983Z","reserved_micros":84000,"state":"review","usage_json":null}]),
 // Same-target terminal evidence is reviewed and source-pinned before recovery.
 // Browser assertions never establish broker completion or a diagnosed correction.
 recoveryReadbacks: Object.freeze([{"attemptId":"yw-dialogue-real-calibration-20261012-v1-amendment-3:attempt-2","receiptDigest":"bec7f49defbb54f917cb1063552e6044ce21a2eaaf6c56aff6ee0911f6d8536d","kind":"provider503","providerStatus":503,"providerAttemptCount":1,"brokerCompleted":true,"noOutput":true,"model":"gemini-3.6-flash","fallback":false,"hedge":false,"backgroundCalls":0,"retryAfterMs":1000,"evidenceRef":"yw-amendment3-01a132c3/GATEWAY-DIAGNOSIS-2.json","evidenceSha256":"c4d2a833b6f5340f86843e03dd0a5a7b79b2194c787ac4892146d3e37c64440e","invocationHash":"59347a97f465e3bc099e86ac989a9fc19a877e113c619afb634aa6c19bd3ae24"}]),
});
