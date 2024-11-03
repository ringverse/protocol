# Oura Ring - app data storage

## iOS

In iTunes backups Oura Ring application data can be found at `/Applications/AppDomain-com.ouraring.oura/`.

Main database is located at `/Applications/AppDomain-com.ouraring.oura/USER_ID/assa.sqlite` (USER_ID is all uppercase UUID).

Ring key can be retrieved from the `ringconfiguration` table.

```sql
SELECT id, auth_key FROM ringconfiguration
```

### Android

TODO: Investigate.
