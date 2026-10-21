#!/usr/bin/env python3
"""Activate tickets_20 purchase option and print product states."""
import sys, json
from google.oauth2 import service_account
from google.auth.transport.requests import AuthorizedSession

PKG = "jp.fromscratch.hitorimondo"
A = f"https://androidpublisher.googleapis.com/androidpublisher/v3/applications/{PKG}"
s = AuthorizedSession(service_account.Credentials.from_service_account_file(
    sys.argv[1], scopes=["https://www.googleapis.com/auth/androidpublisher"]))

req = {"requests": [{"activatePurchaseOptionRequest": {
    "packageName": PKG, "productId": "tickets_20", "purchaseOptionId": "default"}}]}
for path in ["onetimeproducts/tickets_20/purchaseOptions:batchUpdateStates",
             "onetimeproducts/-/purchaseOptions:batchUpdateStates",
             "oneTimeProducts/tickets_20/purchaseOptions:batchUpdateStates"]:
    r = s.post(f"{A}/{path}", json=req)
    print(r.status_code, path, r.text[:200].replace("\n", " ") if r.status_code >= 300 else "")
    if r.status_code < 300:
        break

p = s.get(f"{A}/onetimeproducts/tickets_20").json()
print("tickets_20:", [(o.get("purchaseOptionId"), o.get("state")) for o in p.get("purchaseOptions", [])])
sub = s.get(f"{A}/subscriptions/monthly_480").json()
print("monthly_480:", [(b.get("basePlanId"), b.get("state")) for b in sub.get("basePlans", [])])
