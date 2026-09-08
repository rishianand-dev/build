# Capability registry — derived from existing frontend API layer

Source: `end-points.ts` + `api/*.ts` (existing Next.js frontend service layer). 174 functions extracted and auto-tagged with a builder-relevant capability and, where applicable, which section type(s) in the builder would consume them.

**All `request_body_fields_guess` values are heuristically extracted from source code and must be verified against real backend contracts before being used for automated payload generation (Phase 5 of the agent build). Treat this file as a first-pass map, not a validated OpenAPI spec.**

All calls are `POST` to a single gateway base URL, Bearer-token auth (`pg_token` cookie) unless noted otherwise.

---

## List products  (11)

| Service | Function | Method | Path | Auth | Body fields (guess) | Maps to section(s) |
|---|---|---|---|---|---|---|
| ProductService | `searchByProducts` | POST | `/entity-products/list-based-on-source` | yes | — | Best, Collections, Feature, Grid, Search |
| ProductService | `getSpecialProducts` | POST | `/entity-products/source-ecom/list` | yes | — | Best, Collections, Feature, Grid |
| ProductService | `getSimilarProducts` | POST | `/entity-products/source-ecom/similar-products/list` | no | attribute_id, brand_id, entity_id, extra_label_id, field_values, gte, lte, min_retail_price, options, page, page_size, product_id, sort, specifications | Best, Collections, Compare, Feature, Grid |
| ProductService | `getRelatedProducts` | POST | `/entity-products/source-ecom/related-products/list` | yes | entity_id, page, page_size, product_id | Best, Collections, Feature, Grid |
| ProductService | `getComplimentaryProducts` | POST | `/entity-products/source-ecom/complimentary-products/list` | yes | entity_id, page, page_size, product_id | Best, Collections, Feature, Grid |
| ProductService | `getCrossSellingProducts` | POST | `/entity-products/source-ecom/cross-selling-products/list` | yes | entity_id, page, page_size, product_id | Best, Collections, Feature, Grid |
| ProductService | `getAllProducts` | POST | `/entity-products/source-ecom/list` | yes | — | Best, Collections, Feature, Grid |
| WishListService | `getWishlistProductIds` | POST | `/customer-favourite/one` | yes | — | Best, Collections, Feature, Grid |
| WishListService | `getWishlistProducts` | POST | `<unresolved:variants>` | yes | message, page, page_size | Best, Collections, Feature, Grid |
| WishListService | `deleteWishlistProduct` | PATCH | `/customer-favourite/products/delete` | yes | products | Best, Collections, Feature, Grid |
| WishListService | `addProductToWishlist` | PUT | `/customer-favourite/products/update` | yes | — | Best, Collections, Feature, Grid |

## Get product detail  (1)

| Service | Function | Method | Path | Auth | Body fields (guess) | Maps to section(s) |
|---|---|---|---|---|---|---|
| ProductService | `fetchSingleProduct` | POST | `/entity-products/source-ecom/one/slug` | yes | products | ProductCard |

## List similar products  (1)

| Service | Function | Method | Path | Auth | Body fields (guess) | Maps to section(s) |
|---|---|---|---|---|---|---|
| ProductService | `getSimilarProducts` | POST | `/entity-products/source-ecom/similar-products/list` | no | attribute_id, brand_id, entity_id, extra_label_id, field_values, gte, lte, min_retail_price, options, page, page_size, product_id, sort, specifications | Best, Collections, Compare, Feature, Grid |

## List related products  (1)

| Service | Function | Method | Path | Auth | Body fields (guess) | Maps to section(s) |
|---|---|---|---|---|---|---|
| ProductService | `getRelatedProducts` | POST | `/entity-products/source-ecom/related-products/list` | yes | entity_id, page, page_size, product_id | Best, Collections, Feature, Grid |

## List cross sell products  (1)

| Service | Function | Method | Path | Auth | Body fields (guess) | Maps to section(s) |
|---|---|---|---|---|---|---|
| ProductService | `getCrossSellingProducts` | POST | `/entity-products/source-ecom/cross-selling-products/list` | yes | entity_id, page, page_size, product_id | Best, Collections, Feature, Grid |

## List complementary products  (1)

| Service | Function | Method | Path | Auth | Body fields (guess) | Maps to section(s) |
|---|---|---|---|---|---|---|
| ProductService | `getComplimentaryProducts` | POST | `/entity-products/source-ecom/complimentary-products/list` | yes | entity_id, page, page_size, product_id | Best, Collections, Feature, Grid |

## List best sellers  (1)

| Service | Function | Method | Path | Auth | Body fields (guess) | Maps to section(s) |
|---|---|---|---|---|---|---|
| ProductService | `getBestSellerProducts` | POST | `/sections/products` | yes | — | Best |

## List collections  (5)

| Service | Function | Method | Path | Auth | Body fields (guess) | Maps to section(s) |
|---|---|---|---|---|---|---|
| WishListService | `getWishlistCollections` | POST | `/collections/list` | yes | — | Collections |
| WishListService | `getWishlistCollectionsById` | POST | `/collections/one` | yes | id, slug | Collections, Title |
| WishListService | `createWishlistCollection` | POST | `/collections/create` | yes | — | Collections |
| WishListService | `updateWishlistCollection` | PUT | `/collections/update` | yes | — | Collections |
| WishListService | `deleteWishlistCollection` | POST | `/collections/delete` | yes | id | Collections |

## Get collection detail  (1)

| Service | Function | Method | Path | Auth | Body fields (guess) | Maps to section(s) |
|---|---|---|---|---|---|---|
| WishListService | `getWishlistCollectionsById` | POST | `/collections/one` | yes | id, slug | Collections, Title |

## List categories  (3)

| Service | Function | Method | Path | Auth | Body fields (guess) | Maps to section(s) |
|---|---|---|---|---|---|---|
| CategoriesService | `getCategories` | POST | `/categories/list-with-seo` | yes | entity_id, master_catalogue_id | Grid, Logos, Menu |
| ProductService | `getHighlightCatalogue` | POST | `/categories/list-by-highlight` | yes | — | Best, Feature, Grid, Logos, Menu |
| ProductService | `getSearchPageCatalogue` | POST | `/categories/list-by-search-key` | yes | — | Grid, Logos, Menu, Search |

## List highlights  (3)

| Service | Function | Method | Path | Auth | Body fields (guess) | Maps to section(s) |
|---|---|---|---|---|---|---|
| CheckoutService | `getLastMinuteHighlight` | POST | `/highlights/list-with-last-minute-offers` | yes | page, page_size | Best, Feature |
| HighlightService | `getHighlightList` | POST | `/highlights/list` | yes | id | Best, Feature |
| ProductService | `getHighlightCatalogue` | POST | `/categories/list-by-highlight` | yes | — | Best, Feature, Grid, Logos, Menu |

## List filter options  (1)

| Service | Function | Method | Path | Auth | Body fields (guess) | Maps to section(s) |
|---|---|---|---|---|---|---|
| ProductService | `getSpecialProductsOptions` | POST | `/entity-products/source-ecom/filters/options` | yes | — | Collections (filter UI) |

## List product specifications  (1)

| Service | Function | Method | Path | Auth | Body fields (guess) | Maps to section(s) |
|---|---|---|---|---|---|---|
| ProductService | `getSpecialProductsSpecifications` | POST | `/entity-products/source-ecom/filters` | yes | — | Specification |

## Get size chart  (1)

| Service | Function | Method | Path | Auth | Body fields (guess) | Maps to section(s) |
|---|---|---|---|---|---|---|
| ProductService | `getSizeChartInfo` | POST | `/types/one` | yes | id | ProductCard, Specification |

## Get stock details  (1)

| Service | Function | Method | Path | Auth | Body fields (guess) | Maps to section(s) |
|---|---|---|---|---|---|---|
| ProductService | `getStockDetails` | POST | `/entity-products/other-entities` | yes | — | ProductCard |

## List ornaments  (1)

| Service | Function | Method | Path | Auth | Body fields (guess) | Maps to section(s) |
|---|---|---|---|---|---|---|
| ProductService | `getOrnamentsList` | POST | `/ornaments/source-ecom/list` | yes | — | — |

## Search products  (2)

| Service | Function | Method | Path | Auth | Body fields (guess) | Maps to section(s) |
|---|---|---|---|---|---|---|
| ProductService | `searchByProducts` | POST | `/entity-products/list-based-on-source` | yes | — | Best, Collections, Feature, Grid, Search |
| ProductService | `getSearchPageCatalogue` | POST | `/categories/list-by-search-key` | yes | — | Grid, Logos, Menu, Search |

## Search suggestions  (2)

| Service | Function | Method | Path | Auth | Body fields (guess) | Maps to section(s) |
|---|---|---|---|---|---|---|
| ProductService | `searchSuggestion` | POST | `/entity-products/search-suggestions` | yes | — | Search |
| suggest-product-services | `SuggestProduct` | POST | `/entity-products/search-suggestions` | yes | — | Search |

## Trending searches  (1)

| Service | Function | Method | Path | Auth | Body fields (guess) | Maps to section(s) |
|---|---|---|---|---|---|---|
| ProductService | `getsearcingKeywords` | POST | `/trending-keywords/list` | yes | — | Search |

## List product reviews  (4)

| Service | Function | Method | Path | Auth | Body fields (guess) | Maps to section(s) |
|---|---|---|---|---|---|---|
| rating-service | `orderReview` | POST | `/products-reviews/ecom/create` | yes | — | Compare, ProductCard |
| rating-service | `checkOrderReviewSubmission` | POST | `/products-reviews/ecom/create` | yes | — | Compare, ProductCard |
| rating-service | `orderProductReview` | POST | `/products-reviews/ecom/create` | yes | — | Compare, ProductCard |
| rating-service | `createEcomProductReview` | POST | `/products-reviews/ecom/create` | yes | — | Compare, ProductCard |

## Submit review  (4)

| Service | Function | Method | Path | Auth | Body fields (guess) | Maps to section(s) |
|---|---|---|---|---|---|---|
| rating-service | `orderReview` | POST | `/products-reviews/ecom/create` | yes | — | Compare, ProductCard |
| rating-service | `checkOrderReviewSubmission` | POST | `/products-reviews/ecom/create` | yes | — | Compare, ProductCard |
| rating-service | `orderProductReview` | POST | `/products-reviews/ecom/create` | yes | — | Compare, ProductCard |
| rating-service | `createEcomProductReview` | POST | `/products-reviews/ecom/create` | yes | — | Compare, ProductCard |

## Get form definition  (1)

| Service | Function | Method | Path | Auth | Body fields (guess) | Maps to section(s) |
|---|---|---|---|---|---|---|
| FormsService | `getFormDetail` | POST | `/form-groups/list-with-attributes` | yes | form_id | Form |

## Submit form  (1)

| Service | Function | Method | Path | Auth | Body fields (guess) | Maps to section(s) |
|---|---|---|---|---|---|---|
| FormsService | `submitForm` | POST | `/form-data/submit` | yes | — | Form, News_letter |

## Newsletter subscribe  (2)

| Service | Function | Method | Path | Auth | Body fields (guess) | Maps to section(s) |
|---|---|---|---|---|---|---|
| email-confirmation | `pushSubscribeEmail` | POST | `/email-subscribe` | yes | — | News_letter |
| email-confirmation | `subscribeEmail` | POST | `/communication-subscription-customers/subscribe` | yes | — | News_letter |

## Get cms content  (3)

| Service | Function | Method | Path | Auth | Body fields (guess) | Maps to section(s) |
|---|---|---|---|---|---|---|
| BusinessSettingService | `getCms` | POST | `/business-units/cms` | yes | id | Collapsible, Feature, Title |
| CmsService | `getQuestionAndAnswers` | POST | `/cms/one` | yes | id | Collapsible, Feature, Title |
| CmsService | `getCmsPages` | POST | `<unresolved:getCmsPagesEndPoint>` | yes | page, page_size | Collapsible, Feature, Title |

## Get faqs  (0)

| Service | Function | Method | Path | Auth | Body fields (guess) | Maps to section(s) |
|---|---|---|---|---|---|---|

## Get about us page  (0)

| Service | Function | Method | Path | Auth | Body fields (guess) | Maps to section(s) |
|---|---|---|---|---|---|---|

## Get policy page  (0)

| Service | Function | Method | Path | Auth | Body fields (guess) | Maps to section(s) |
|---|---|---|---|---|---|---|

## Get theme page data  (4)

| Service | Function | Method | Path | Auth | Body fields (guess) | Maps to section(s) |
|---|---|---|---|---|---|---|
| ThemeService | `getThemeData` | POST | `/direct/direct-theme/publish-pages` | no | message | — |
| ThemeService | `getGenericHeaderFooter` | POST | `/direct/direct-theme/pages/generic` | no | — | — |
| ThemeService | `getSinglePageData` | POST | `/direct/direct-theme/publish-pages` | no | channel, draft_page_id, page_name, process_page | — |
| ThemeService | `getProductcard` | POST | `/direct/direct-theme/publish-pages` | no | — | — |

## Get seo metadata  (9)

| Service | Function | Method | Path | Auth | Body fields (guess) | Maps to section(s) |
|---|---|---|---|---|---|---|
| CategoriesService | `getCategories` | POST | `/categories/list-with-seo` | yes | entity_id, master_catalogue_id | Grid, Logos, Menu |
| HighlightService | `get` | POST | `/seo/one` | yes | url_slug | — |
| ProductService | `fetchSeoOfProduct` | POST | `/entity-products/source-ecom/one` | yes | related_products_flag_required, similar_products_flag_required | — |
| SeoService | `category` | POST | `/direct/seo/category` | no | slug | — |
| SeoService | `listPage` | POST | `<unresolved:getSeoEndpoint>` | no | default | — |
| SeoService | `subCategory` | POST | `/direct/seo/sub-category` | no | slug | — |
| SeoService | `classfication` | POST | `/direct/seo/classification` | no | slug | — |
| SeoService | `highlight` | POST | `/direct/seo/highlight` | no | slug | — |
| SeoService | `product` | POST | `/direct/seo/product` | no | slug | — |

## Get business settings  (2)

| Service | Function | Method | Path | Auth | Body fields (guess) | Maps to section(s) |
|---|---|---|---|---|---|---|
| BusinessSettingService | `getBusinessSettings` | POST | `/business-units/one` | yes | domain_url | — |
| BusinessSettingService | `getDirectBusinessSettings` | POST | `/direct/business-units/one` | yes | domain_url | — |

## List stores  (6)

| Service | Function | Method | Path | Auth | Body fields (guess) | Maps to section(s) |
|---|---|---|---|---|---|---|
| HomeService | `getStores` | POST | `/business-units/default-entity` | yes | — | — |
| HomeService | `getStoreByEntityId` | POST | `/entities/one` | yes | id | — |
| HomeService | `getStoreCountries` | POST | `/countries/one` | yes | id | — |
| HomeService | `getExperienceStore` | POST | `/entities/one` | yes | is_experience_entity | — |
| loyalty-services | `getLoyaltyHistoryCustomerDetails` | POST | `/loyalty-history/get-customer-details?client=Turtle&storeCode=63&source=Ginesys` | yes | — | — |
| ShoppingCartService | `addProduct` | PUT | `/stores/${storeId}/shopping-carts/carts/${cart_id}/products?filterType=CartDetails` | yes | locationId | — |

## Upload image  (2)

| Service | Function | Method | Path | Auth | Body fields (guess) | Maps to section(s) |
|---|---|---|---|---|---|---|
| CustomerService | `imageUploader` | POST | `/containers/${imagePath}/upload?filename=${imageName}` | yes | — | — |
| ImageUploadService | `uploadImage` | POST | `/customers/file/upload` | yes | — | — |

## Apply coupon  (2)

| Service | Function | Method | Path | Auth | Body fields (guess) | Maps to section(s) |
|---|---|---|---|---|---|---|
| ShoppingCartService | `promoCodeValidate` | POST | `/coupons/apply` | yes | — | — |
| ShoppingCartService | `sendCouponOTPValidate` | POST | `/coupons/send-otp` | yes | — | — |

## Authentication  (13)

| Service | Function | Method | Path | Auth | Body fields (guess) | Maps to section(s) |
|---|---|---|---|---|---|---|
| CampaignService | `registerVendor` | POST | `/vendors/register` | yes | — | — |
| CampaignService | `validateVendorOtp` | POST | `/vendors/validate-otp` | yes | — | — |
| CustomerService | `verifyCustomer` | POST | `/authentication/customer/otp` | yes | — | — |
| CustomerService | `getLoginOtp` | POST | `/authentication/customer/login-otp` | yes | — | — |
| CustomerService | `verifyLogin` | POST | `/authentication/customer/login-verify` | yes | — | — |
| CustomerService | `getRegisterOtp` | POST | `/authentication/customer/register-otp` | yes | — | — |
| CustomerService | `verifyRegister` | POST | `/authentication/customer/register-verify` | yes | — | — |
| CustomerService | `validateCustomer` | POST | `/authentication/customer/verify` | yes | message | — |
| CustomerService | `removeTokenFromProfile` | POST | `/bulk/device-tokens` | yes | — | — |
| HomeService | `accessToken` | POST | `/authentication/customer/verify` | yes | message | — |
| HomeService | `pgAccessToken` | POST | `/token` | yes | — | — |
| ShoppingCartService | `sendCouponOTPValidate` | POST | `/coupons/send-otp` | yes | — | — |
| ShoppingCartService | `sendOtpForInternalPromo` | POST | `<unresolved:sendOtpEndPoints>` | yes | — | — |

## Cancel order  (3)

| Service | Function | Method | Path | Auth | Body fields (guess) | Maps to section(s) |
|---|---|---|---|---|---|---|
| orders-service | `getOrderReason` | POST | `/sales-orders/cancel-status-reasons` | yes | — | — |
| orders-service | `cancelOrder` | POST | `/sales-orders/cancel` | yes | — | — |
| orders-service | `cancelOrderItem` | POST | `/sales-orders/cancel-item` | yes | — | — |

## Create appointment  (2)

| Service | Function | Method | Path | Auth | Body fields (guess) | Maps to section(s) |
|---|---|---|---|---|---|---|
| AppointmentService | `createAppointment` | POST | `/appointments/create` | yes | — | — |
| AppointmentService | `createJoiningLink` | POST | `/appointments/generate-meeting-link` | yes | — | — |

## Create cart  (1)

| Service | Function | Method | Path | Auth | Body fields (guess) | Maps to section(s) |
|---|---|---|---|---|---|---|
| ShoppingCartService | `getCartId` | POST | `/cart/create` | yes | — | — |

## Create collection  (1)

| Service | Function | Method | Path | Auth | Body fields (guess) | Maps to section(s) |
|---|---|---|---|---|---|---|
| WishListService | `createWishlistCollection` | POST | `/collections/create` | yes | — | Collections |

## Create order  (6)

| Service | Function | Method | Path | Auth | Body fields (guess) | Maps to section(s) |
|---|---|---|---|---|---|---|
| orders-service | `createOrder` | POST | `<unresolved:endpoint>` | yes | — | — |
| orders-service | `createExchangeOrder` | POST | `/exchanges/create` | yes | — | — |
| rating-service | `orderReview` | POST | `/products-reviews/ecom/create` | yes | — | Compare, ProductCard |
| rating-service | `checkOrderReviewSubmission` | POST | `/products-reviews/ecom/create` | yes | — | Compare, ProductCard |
| rating-service | `orderProductReview` | POST | `/products-reviews/ecom/create` | yes | — | Compare, ProductCard |
| return-order-service | `createReturnOrder` | POST | `/sales-returns/create-multi` | yes | — | — |

## Customer address management  (5)

| Service | Function | Method | Path | Auth | Body fields (guess) | Maps to section(s) |
|---|---|---|---|---|---|---|
| CustomerService | `getAddresses` | POST | `/addresses/list` | yes | — | — |
| CustomerService | `updateAddress` | PUT | `/addresses/modify` | yes | — | — |
| CustomerService | `addAddress` | POST | `<unresolved:addCustomerAddressEndPoint>` | yes | — | — |
| CustomerService | `deleteAddress` | PATCH | `/addresses/delete` | yes | — | — |
| CustomerService | `getAddressesByPincode` | POST | `/customers/available-addresses` | yes | — | — |

## Delete collection  (1)

| Service | Function | Method | Path | Auth | Body fields (guess) | Maps to section(s) |
|---|---|---|---|---|---|---|
| WishListService | `deleteWishlistCollection` | POST | `/collections/delete` | yes | id | Collections |

## Get appointment availability  (2)

| Service | Function | Method | Path | Auth | Body fields (guess) | Maps to section(s) |
|---|---|---|---|---|---|---|
| AppointmentService | `getAppointmentDates` | POST | `/appointment-slots/available-range` | yes | business_unit_id, end_date, entity_id, start_date | — |
| AppointmentService | `getAppointmentSlots` | POST | `/appointment-slots/available` | yes | business_unit_id, date, entity_id | — |

## Get cart  (6)

| Service | Function | Method | Path | Auth | Body fields (guess) | Maps to section(s) |
|---|---|---|---|---|---|---|
| BuyNowService | `getBuyNowCartDetails` | POST | `/buy-now-cart/one-cart` | yes | — | — |
| BuyNowService | `getBuyNowCheckoutDetails` | POST | `/buy-now-cart/one-cart-on-checkout` | yes | — | — |
| ShoppingCartService | `getCartId` | POST | `/cart/create` | yes | — | — |
| ShoppingCartService | `addProduct` | PUT | `/stores/${storeId}/shopping-carts/carts/${cart_id}/products?filterType=CartDetails` | yes | locationId | — |
| ShoppingCartService | `getCartDetails` | POST | `<unresolved:isGuest>` | yes | — | — |
| ShoppingCartService | `getCheckoutDetails` | POST | `/cart/one-cart-on-checkout` | yes | — | — |

## Get customer profile  (9)

| Service | Function | Method | Path | Auth | Body fields (guess) | Maps to section(s) |
|---|---|---|---|---|---|---|
| CampaignService | `customerCampaignDetails` | POST | `/customer-acquisition-campaign/get-details` | yes | code | — |
| CustomerService | `customerProfile` | POST | `/customers/one` | yes | — | — |
| CustomerService | `updateCustomerProfile` | PUT | `/customers/update` | yes | — | — |
| CustomerService | `deleteCustomerProfile` | PATCH | `/customers/delete` | yes | message | — |
| CustomerService | `logoutCustomerProfile` | GET | `/customers/logout` | yes | — | — |
| loyalty-services | `getLoyaltyHistoryCustomerDetails` | POST | `/loyalty-history/get-customer-details?client=Turtle&storeCode=63&source=Ginesys` | yes | — | — |
| loyalty-services | `getCustomerDetails` | POST | `/customers/get-details` | yes | — | — |
| loyalty-services | `getAllowedLoyaltyPoints` | POST | `/customers/get-allowed-loyalty-details` | yes | amount, business_unit_id, customer_id | — |
| ShoppingCartService | `profileCoupon` | POST | `/coupons/all/customer/mobile` | yes | — | — |

## Get order history  (8)

| Service | Function | Method | Path | Auth | Body fields (guess) | Maps to section(s) |
|---|---|---|---|---|---|---|
| orders-service | `getOrdersHistory` | POST | `/parent-sales-orders/ecom-list` | yes | channel, customer_id, customer_mobile, page, page_size, type | — |
| orders-service | `getReturnedOrdersHistory` | POST | `/parent-sales-returns/ecom-list` | yes | channel, customer_id, customer_mobile, page, page_size | — |
| orders-service | `getExchangedOrdersHistory` | POST | `/parent-sales-orders/ecom-list` | yes | channel, customer_id, customer_mobile, page, page_size, type | — |
| orders-service | `getOneOrderHistory` | POST | `<unresolved:type>` | yes | id | — |
| orders-service | `getPosOrders` | POST | `/parent-sales-orders/ecom-list` | yes | channel, customer_id, customer_mobile, page, page_size | — |
| orders-service | `getPosOrdersById` | POST | `/sales-orders/one` | yes | — | — |
| orders-service | `trackGuestOrder` | POST | `/parent-sales-orders/one` | yes | code | — |
| ShoppingCartService | `getOrderIdByPaymentOrderId` | POST | `/transactions/one` | yes | payment_order_id | — |

## Gift cards  (2)

| Service | Function | Method | Path | Auth | Body fields (guess) | Maps to section(s) |
|---|---|---|---|---|---|---|
| CheckoutService | `getGiftCards` | POST | `/finance-payment-products/gift-card-analytics` | yes | — | — |
| CheckoutService | `getGiftCardAnalytics` | POST | `/finance-payment-products/gift-card-analytics` | yes | — | — |

## List coupons  (6)

| Service | Function | Method | Path | Auth | Body fields (guess) | Maps to section(s) |
|---|---|---|---|---|---|---|
| CustomerService | `getActiveVouchers` | POST | `/coupons/all/customer/mobile` | yes | — | — |
| ShoppingCartService | `getCampaignCoupon` | POST | `/coupons/all/customer/mobile` | yes | — | — |
| ShoppingCartService | `cartProductOffers` | POST | `/coupons/customer` | yes | — | — |
| ShoppingCartService | `profileCoupon` | POST | `/coupons/all/customer/mobile` | yes | — | — |
| ShoppingCartService | `couponProductOffers` | POST | `/coupons/all/customer/mobile` | yes | — | — |
| ShoppingCartService | `getCustomerCoupon` | POST | `/coupons/single` | yes | — | — |

## Loyalty points  (6)

| Service | Function | Method | Path | Auth | Body fields (guess) | Maps to section(s) |
|---|---|---|---|---|---|---|
| loyalty-services | `loyaltyPointsConversion` | POST | `/redemption/conversion-value` | yes | — | — |
| loyalty-services | `getLoyaltyHistoryCustomerDetails` | POST | `/loyalty-history/get-customer-details?client=Turtle&storeCode=63&source=Ginesys` | yes | — | — |
| loyalty-services | `redeemLoyaltyPoints` | POST | `/customers/redeem-loyalty-points` | yes | — | — |
| loyalty-services | `clearReservedLoyaltyPoints` | POST | `/customers/clear-reserve-loyalty-points` | yes | — | — |
| loyalty-services | `getCustomerLoyaltyHistory` | POST | `/loyalty-history/list` | yes | — | — |
| loyalty-services | `getAllowedLoyaltyPoints` | POST | `/customers/get-allowed-loyalty-details` | yes | amount, business_unit_id, customer_id | — |

## Update cart  (3)

| Service | Function | Method | Path | Auth | Body fields (guess) | Maps to section(s) |
|---|---|---|---|---|---|---|
| BuyNowService | `updateProductInBuyNow` | PUT | `/buy-now-cart/update` | yes | — | — |
| ShoppingCartService | `addProduct` | PUT | `/stores/${storeId}/shopping-carts/carts/${cart_id}/products?filterType=CartDetails` | yes | locationId | — |
| ShoppingCartService | `updateCart` | PUT | `/cart/update` | yes | — | — |

## Update collection  (1)

| Service | Function | Method | Path | Auth | Body fields (guess) | Maps to section(s) |
|---|---|---|---|---|---|---|
| WishListService | `updateWishlistCollection` | PUT | `/collections/update` | yes | — | Collections |

## Update customer profile  (2)

| Service | Function | Method | Path | Auth | Body fields (guess) | Maps to section(s) |
|---|---|---|---|---|---|---|
| CustomerService | `updateCustomerProfile` | PUT | `/customers/update` | yes | — | — |
| WishListService | `addProductToWishlist` | PUT | `/customer-favourite/products/update` | yes | — | Best, Collections, Feature, Grid |

## Wishlist management  (16)

| Service | Function | Method | Path | Auth | Body fields (guess) | Maps to section(s) |
|---|---|---|---|---|---|---|
| CheckoutService | `getLastMinuteHighlight` | POST | `/highlights/list-with-last-minute-offers` | yes | page, page_size | Best, Feature |
| HighlightService | `getHighlightList` | POST | `/highlights/list` | yes | id | Best, Feature |
| HighlightService | `get` | POST | `/highlights/one` | yes | id | — |
| ProductService | `saveFeed` | POST | `/customers/add-highlight` | yes | — | — |
| ProductService | `removeFeed` | POST | `/customers/remove-highlight` | yes | — | — |
| ProductService | `getSavedFeed` | POST | `/customers/get-highlights` | yes | — | — |
| WishListService | `getWishlistProductIds` | POST | `/customer-favourite/one` | yes | — | Best, Collections, Feature, Grid |
| WishListService | `getWishlistProducts` | POST | `<unresolved:variants>` | yes | message, page, page_size | Best, Collections, Feature, Grid |
| WishListService | `deleteBasketPrd` | PUT | `/customers/wishlists` | yes | — | — |
| WishListService | `deleteWishlistProduct` | PATCH | `/customer-favourite/products/delete` | yes | products | Best, Collections, Feature, Grid |
| WishListService | `addProductToWishlist` | PUT | `/customer-favourite/products/update` | yes | — | Best, Collections, Feature, Grid |
| WishListService | `getWishlistCollections` | POST | `/collections/list` | yes | — | Collections |
| WishListService | `getWishlistCollectionsById` | POST | `/collections/one` | yes | id, slug | Collections, Title |
| WishListService | `createWishlistCollection` | POST | `/collections/create` | yes | — | Collections |
| WishListService | `updateWishlistCollection` | PUT | `/collections/update` | yes | — | Collections |
| WishListService | `deleteWishlistCollection` | POST | `/collections/delete` | yes | id | Collections |

## Uncategorized  (42)

_Account/checkout/logistics operations — not directly needed for page-content rendering. Kept for completeness._

| Service | Function | Method | Path | Auth | Body fields (guess) | Maps to section(s) |
|---|---|---|---|---|---|---|
| AppointmentService | `getProviderConfigurations` | POST | `/provider-configurations/list` | yes | active_flag | — |
| BusinessSettingService | `getBusinessPages` | POST | `/business-pages/list` | yes | active_flag, business_unit_id, page_type | — |
| BusinessSettingService | `getEnvironmentVariables` | POST | `/environment-variables/list` | yes | business_unit_id | — |
| CampaignService | `vendorCampaignDetails` | POST | `/vendor-acquisition-campaign/get-details` | yes | code | — |
| CampaignService | `submit` | POST | `/customer-acquisition-leads/create` | yes | — | — |
| CampaignService | `vendorSubmit` | POST | `/vendor-acquisition-leads/create` | yes | — | — |
| CampaignService | `initializePayU` | POST | `/payment-provider-configurations/request` | yes | — | — |
| CheckoutService | `getDeliveryInstructions` | POST | `delivery-instructions/list` | yes | — | — |
| CheckoutService | `getShippingDetails` | POST | `/business-units/shipping-details` | yes | — | — |
| CheckoutService | `getpaymentMethod` | GET | `/payment-types` | yes | businessUnitId | — |
| CmsService | `QAndA` | POST | `/q-and-a/list` | yes | business_unit_id, type | — |
| email-confirmation | `sendMail` | POST | `/templates/send-mail` | yes | — | — |
| FormsService | `checkForm` | POST | `/form-data/check` | yes | — | — |
| HomeService | `getSeviceableLocations` | POST | `/serviceable-locations/list` | yes | — | — |
| HomeService | `getEntityList` | POST | `/entities/list/ecom` | yes | active_flag, business_unit_id, category_id, page_size, show_in_store_locator | — |
| HomeService | `getOneEntity` | POST | `/entities/one` | yes | id | — |
| HomeService | `getEntityCategory` | POST | `/entity-categories/one` | yes | entity_type | — |
| ImageUploadService | `uploadCustomerFile` | POST | `/customers/file/upload` | yes | — | — |
| loyalty-services | `get` | POST | `/redemption/conversion-value` | yes | — | — |
| orders-service | `getSalesOrderDetails` | POST | `<unresolved:type>` | yes | id | — |
| orders-service | `getThankuPageDetails` | POST | `/sales-orders/thankyou` | yes | code | — |
| orders-service | `invoiceDownload` | POST | `/sales-orders/invoice/download` | yes | format, id, pdf | — |
| orders-service | `getTrackingSequence` | POST | `/status-profiles/tracking` | yes | object_type, sales_order_id | — |
| orders-service | `getReturnReason` | POST | `/sales-returns/cancel-status-reasons` | yes | — | — |
| ProductService | `getSpecialProductsById` | POST | `/entity-products/slug` | yes | — | — |
| ProductService | `getV2ProductsById` | POST | `/entity-products/one-based-on-source` | yes | — | — |
| ProductService | `addVisitorAnalytics` | POST | `/sales-orders/alternate-uom-calculations` | yes | — | — |
| ProductService | `deleteScalableProduct` | POST | `/sales-orders/alternate-uom-calculations` | yes | — | — |
| ProductService | `getPriceForScalableProduct` | POST | `/sales-orders/alternate-uom-calculations` | yes | — | — |
| ProductService | `getPromotionalSearch` | POST | `/promotional-search/ecom/list` | yes | entity_id | — |
| return-order-service | `getOrderCalculationForReturn` | POST | `/sales-returns/serve-multi` | yes | — | — |
| return-order-service | `getReturnReasons` | POST | `/sales-returns/cancel-status-reasons` | yes | — | — |
| ShoppingCartService | `refferValidation` | POST | `/agents/referral` | yes | code | — |
| ShoppingCartService | `getAvailableBillBusterOffers` | POST | `/bill-buster/available-list` | yes | — | — |
| ShoppingCartService | `applyBillBuster` | POST | `/bill-buster/apply` | yes | — | — |
| ShoppingCartService | `removeBillBuster` | POST | `/bill-buster/remove` | yes | — | — |
| ShoppingCartService | `singleCouponDetails` | POST | `/coupons/single` | yes | — | — |
| ShoppingCartService | `reorderCheck` | POST | `/cart/reorder-check` | yes | — | — |
| ShoppingCartService | `exchangeServe` | POST | `/exchanges/serve` | yes | — | — |
| suggest-product-services | `suggestNewProduct` | POST | `/product-requests/create` | yes | — | — |
| WishListService | `addSharedCollection` | POST | `/customers/add-shared-collection` | yes | collection_id, customer_id | — |
| WishListService | `getSharedCollectionInformation` | POST | `/customers/get-shared-collection-information` | yes | — | — |
