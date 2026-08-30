CocoBiz v14

Offer scheduling fixes:
- Uses Firestore server data first to avoid stale scheduled-offer state.
- Checks every 10 seconds and on tab visibility, so scheduled offers switch quickly.
- Expired offers disappear immediately for customers.
- Admin view cleans expired offers.
- Firebase scheduled function physically deletes expired offers every 15 minutes.

Deploy frontend to Vercel as usual. For automatic physical deletion, deploy Firebase Functions:
  cd functions
  npm install
  cd ..
  firebase deploy --only functions

The scheduled cleanup function requires the Firebase project to support Cloud Scheduler / scheduled functions billing requirements.
