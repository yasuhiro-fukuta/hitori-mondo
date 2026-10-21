#!/usr/bin/env python3
"""Create in-app products on Google Play: monthly_480 (subscription ¥480/month), tickets_20 (¥240).
Run in Cloud Shell:  python3 products.py ~/sa.json"""
import sys, json
from google.oauth2 import service_account
from google.auth.transport.requests import AuthorizedSession

PKG = "jp.fromscratch.hitorimondo"
A = f"https://androidpublisher.googleapis.com/androidpublisher/v3/applications/{PKG}"
RV = "regionsVersion.version=2022/02"
s = AuthorizedSession(service_account.Credentials.from_service_account_file(
    sys.argv[1], scopes=["https://www.googleapis.com/auth/androidpublisher"]))

def show(r, what):
    print(("OK " if r.status_code < 300 else f"NG {r.status_code} ") + what + ("" if r.status_code < 300 else " " + r.text[:500]))
    return r.status_code < 300

# --- subscription ---
sub = {
    "packageName": PKG, "productId": "monthly_480",
    "listings": [{"languageCode": "ja-JP", "title": "月額プラン",
                  "benefits": ["AIをたっぷり使える", "「深く考える」月30回"],
                  "description": "AIの回答をたっぷり使え、上位モデルの「深く考える」が月30回使えます。"}],
    "basePlans": [{"basePlanId": "monthly",
                   "autoRenewingBasePlanType": {"billingPeriodDuration": "P1M", "gracePeriodDuration": "P3D",
                                                "resubscribeState": "RESUBSCRIBE_STATE_ACTIVE",
                                                "prorationMode": "SUBSCRIPTION_PRORATION_MODE_CHARGE_ON_NEXT_BILLING_DATE",
                                                "legacyCompatible": True},
                   "regionalConfigs": [{"regionCode": "JP", "newSubscriberAvailability": True,
                                        "price": {"currencyCode": "JPY", "units": "480"}}]}],
}
r = s.get(f"{A}/subscriptions/monthly_480")
if r.status_code == 404:
    r = s.post(f"{A}/subscriptions?productId=monthly_480&{RV}", json=sub)
show(r, "subscription monthly_480")
show(s.post(f"{A}/subscriptions/monthly_480/basePlans/monthly:activate", json={}), "activate base plan")

# --- tickets (one-time, consumable) ---
r = s.get(f"{A}/onetimeproducts/tickets_20")
if r.status_code == 404:
    r = s.post(f"{A}/inappproducts?autoConvertMissingPrices=true", json={
        "packageName": PKG, "sku": "tickets_20", "status": "active", "purchaseType": "managedUser",
        "defaultLanguage": "ja-JP", "defaultPrice": {"priceMicros": "240000000", "currency": "JPY"},
        "listings": {"ja-JP": {"title": "回数券20枚", "description": "AIの回答に使える回数券20枚（通常1回1枚、「深く考える」1回3枚。期限なし）"}}})
if not show(r, "inapp tickets_20 (legacy)"):
    body = {"packageName": PKG, "productId": "tickets_20",
            "listings": [{"languageCode": "ja-JP", "title": "回数券20枚",
                          "description": "AIの回答に使える回数券20枚（期限なし）"}],
            "purchaseOptions": [{"purchaseOptionId": "default", "buyOption": {"legacyCompatible": True},
                                 "regionalPricingAndAvailabilityConfigs": [
                                     {"regionCode": "JP", "price": {"currencyCode": "JPY", "units": "240"}, "availability": "AVAILABLE"}]}]}
    r = s.patch(f"{A}/onetimeproducts/tickets_20?allowMissing=true&updateMask=listings,purchaseOptions&{RV}", json=body)
    show(r, "onetime tickets_20")
    r = s.post(f"{A}/onetimeproducts/tickets_20/purchaseOptions:batchUpdateStates", json={"requests": [
        {"activatePurchaseOptionRequest": {"packageName": PKG, "productId": "tickets_20", "purchaseOptionId": "default"}}]})
    show(r, "activate tickets_20")
print("END")
