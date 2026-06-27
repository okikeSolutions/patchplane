/* eslint-disable */
/**
 * Generated `api` utility.
 *
 * THIS CODE IS AUTOMATICALLY GENERATED.
 *
 * To regenerate, run `npx convex dev`.
 * @module
 */

import type * as auth from "../auth.js";
import type * as connectedRepositories from "../connectedRepositories.js";
import type * as http from "../http.js";
import type * as promptRequests from "../promptRequests.js";
import type * as requests from "../requests.js";
import type * as viewer from "../viewer.js";
import type * as workflowRuns from "../workflowRuns.js";
import type * as workflowStarts from "../workflowStarts.js";

import type {
  ApiFromModules,
  FilterApi,
  FunctionReference,
} from "convex/server";

declare const fullApi: ApiFromModules<{
  auth: typeof auth;
  connectedRepositories: typeof connectedRepositories;
  http: typeof http;
  promptRequests: typeof promptRequests;
  requests: typeof requests;
  viewer: typeof viewer;
  workflowRuns: typeof workflowRuns;
  workflowStarts: typeof workflowStarts;
}>;

/**
 * A utility for referencing Convex functions in your app's public API.
 *
 * Usage:
 * ```js
 * const myFunctionReference = api.myModule.myFunction;
 * ```
 */
export declare const api: FilterApi<
  typeof fullApi,
  FunctionReference<any, "public">
>;

/**
 * A utility for referencing Convex functions in your app's internal API.
 *
 * Usage:
 * ```js
 * const myFunctionReference = internal.myModule.myFunction;
 * ```
 */
export declare const internal: FilterApi<
  typeof fullApi,
  FunctionReference<any, "internal">
>;

export declare const components: {
  workOSAuthKit: import("@convex-dev/workos-authkit/_generated/component.js").ComponentApi<"workOSAuthKit">;
};
