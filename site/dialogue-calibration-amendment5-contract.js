// Cost authority is granted. Activation still requires exact isolated source,
// historical receipt reconciliation and a trusted registered activation pin.
export const AMENDMENT5_CONTRACT=Object.freeze({
 version:'yw-calibration-amendment5-v1',
 operation:'yw-dialogue-real-calibration-20261012-v1-amendment-5',
 action:'calibration_amendment5',status:'authorized-preparation',active:false,paidCallsAuthorized:true,
 authorizedAt:'2026-10-13T07:33:57.808694+00:00',
 authorityRef:'continuation-01a132c3/MODEL38-RECALIBRATION-AUTHORITY.json',authorityDigest:'97e5ab009b49ad7bd293f0762bcc8d63bc72f2458708a1f931da372a421cf8b4',
 packetDigest:'9b06b5d0dfaf775db259dfabfc1ae08cdde435e4f92e7949609949117f67ad92',
 model:'gemini-3.8-flash',reserveMicros:84000,maxProviderAttempts:1,
 maxRecoveriesPerCase:1,retries:0,fallback:false,hedge:false,backgroundCalls:0,
 priorAttempts:13,priorKnownMicros:10267,priorUnknownReservedMicros:924000,
 priorReservedMicros:1092000,remainingAttempts:56,remainingReservedMicros:4704000,
 minimumBaseCases:28,minimumExtraAttempts:0,minimumExtraReservedMicros:0,
 approvedNewAttempts:56,approvedNewReservedMicros:4704000,
 worstThreeProviderReservedMicros:14112000,cumulativeSingleProviderReservedMicros:5796000,cumulativeThreeProviderReservedMicros:15204000,
 start:'when-exact-candidate-checks-pass',
 hardExpiry:'2026-10-14T12:00:00Z',
 firstTokenTargetMs:5000,providerCooldownMs:120000,
 // This is immutable evidence, not an approval to resume amendment 3.
 predecessor:Object.freeze({
  operation:'yw-dialogue-real-calibration-20261012-v1-amendment-3',
  packetDigest:'4fb2ac792516d95c00022ad08bda42063e8606bec4989b3d46bc6b86c6a67317',
  deadlineAt:'2026-10-13T02:13:38.293Z',newAttempts:3,uniqueCases:2,passedCases:0,
  firstTokenMs:6055,readbackRequired:true,resumeAuthorized:false,
  stopReceipt:'6c5335944525b6971a130b66cfdd65a221c78075833e97bde3366f316609528a',
 }),
});
