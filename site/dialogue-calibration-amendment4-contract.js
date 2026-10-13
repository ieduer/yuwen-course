// Cost authority is granted. Activation still requires exact isolated source,
// historical receipt reconciliation and a trusted registered activation pin.
export const AMENDMENT4_CONTRACT=Object.freeze({
 version:'yw-calibration-amendment4-v1',
 operation:'yw-dialogue-real-calibration-20261012-v1-amendment-4',
 action:'calibration_amendment4',status:'authorized-preparation',active:false,paidCallsAuthorized:true,
 authorizedAt:'2026-10-13T02:17:10.457557Z',
 authorityRef:'continuation-01a132c3/COST-EXECUTION-AUTHORITY.json',authorityDigest:'f4bcaf4dc2fd6e0303b71920810184a7f81f54b14bc351b9388517c3972ed2a1',
 packetDigest:'569ee7e452756f4044025902b4b75fb9883f5ab8f962f0454f322cb883f0f002',
 model:'gemini-3.6-flash',reserveMicros:84000,maxProviderAttempts:1,
 maxRecoveriesPerCase:1,retries:0,fallback:false,hedge:false,backgroundCalls:0,
 priorAttempts:7,priorKnownMicros:10267,priorUnknownReservedMicros:420000,
 priorReservedMicros:588000,remainingAttempts:23,remainingReservedMicros:1932000,
 minimumBaseCases:28,minimumExtraAttempts:5,minimumExtraReservedMicros:420000,
 approvedNewAttempts:56,approvedNewReservedMicros:4704000,
 worstThreeProviderReservedMicros:14112000,cumulativeSingleProviderReservedMicros:5292000,cumulativeThreeProviderReservedMicros:14700000,
 start:'when-exact-candidate-checks-pass',
 hardExpiry:'2026-10-13T12:00:00Z',
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
