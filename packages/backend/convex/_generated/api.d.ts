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
import type * as crons from "../crons.js";
import type * as http from "../http.js";
import type * as promptRequests from "../promptRequests.js";
import type * as protectedExecutionValidator from "../protectedExecutionValidator.js";
import type * as requests from "../requests.js";
import type * as viewer from "../viewer.js";
import type * as workflowRuns from "../workflowRuns.js";
import type * as workflowStarts from "../workflowStarts.js";
import type * as workflowStarts_candidates from "../workflowStarts/candidates.js";
import type * as workflowStarts_deliveries from "../workflowStarts/deliveries.js";
import type * as workflowStarts_lifecycle from "../workflowStarts/lifecycle.js";
import type * as workflowStarts_readModels from "../workflowStarts/readModels.js";
import type * as workflowStarts_readModels_publicationFixture from "../workflowStarts/readModels/publicationFixture.js";
import type * as workflowStarts_readModels_recentWorkflows from "../workflowStarts/readModels/recentWorkflows.js";
import type * as workflowStarts_readModels_workflowDetail from "../workflowStarts/readModels/workflowDetail.js";
import type * as workflowStarts_reviewPublication from "../workflowStarts/reviewPublication.js";
import type * as workflowStarts_runtimeEvidence from "../workflowStarts/runtimeEvidence.js";
import type * as workflowStarts_shared from "../workflowStarts/shared.js";
import type * as workflowStarts_shared_foundation from "../workflowStarts/shared/foundation.js";
import type * as workflowStarts_shared_integrity from "../workflowStarts/shared/integrity.js";
import type * as workflowStarts_shared_readModelSchemas from "../workflowStarts/shared/readModelSchemas.js";
import type * as workflowStarts_shared_reviewSchemas from "../workflowStarts/shared/reviewSchemas.js";
import type * as workflowStarts_shared_verificationSchemas from "../workflowStarts/shared/verificationSchemas.js";
import type * as workflowStarts_shared_workflowPersistence from "../workflowStarts/shared/workflowPersistence.js";
import type * as workflowStarts_verification from "../workflowStarts/verification.js";
import type * as workflowStarts_verification_executionGroups from "../workflowStarts/verification/executionGroups.js";
import type * as workflowStarts_verification_plans from "../workflowStarts/verification/plans.js";
import type * as workflowStarts_verification_results from "../workflowStarts/verification/results.js";

import type {
  ApiFromModules,
  FilterApi,
  FunctionReference,
} from "convex/server";

declare const fullApi: ApiFromModules<{
  auth: typeof auth;
  connectedRepositories: typeof connectedRepositories;
  crons: typeof crons;
  http: typeof http;
  promptRequests: typeof promptRequests;
  protectedExecutionValidator: typeof protectedExecutionValidator;
  requests: typeof requests;
  viewer: typeof viewer;
  workflowRuns: typeof workflowRuns;
  workflowStarts: typeof workflowStarts;
  "workflowStarts/candidates": typeof workflowStarts_candidates;
  "workflowStarts/deliveries": typeof workflowStarts_deliveries;
  "workflowStarts/lifecycle": typeof workflowStarts_lifecycle;
  "workflowStarts/readModels": typeof workflowStarts_readModels;
  "workflowStarts/readModels/publicationFixture": typeof workflowStarts_readModels_publicationFixture;
  "workflowStarts/readModels/recentWorkflows": typeof workflowStarts_readModels_recentWorkflows;
  "workflowStarts/readModels/workflowDetail": typeof workflowStarts_readModels_workflowDetail;
  "workflowStarts/reviewPublication": typeof workflowStarts_reviewPublication;
  "workflowStarts/runtimeEvidence": typeof workflowStarts_runtimeEvidence;
  "workflowStarts/shared": typeof workflowStarts_shared;
  "workflowStarts/shared/foundation": typeof workflowStarts_shared_foundation;
  "workflowStarts/shared/integrity": typeof workflowStarts_shared_integrity;
  "workflowStarts/shared/readModelSchemas": typeof workflowStarts_shared_readModelSchemas;
  "workflowStarts/shared/reviewSchemas": typeof workflowStarts_shared_reviewSchemas;
  "workflowStarts/shared/verificationSchemas": typeof workflowStarts_shared_verificationSchemas;
  "workflowStarts/shared/workflowPersistence": typeof workflowStarts_shared_workflowPersistence;
  "workflowStarts/verification": typeof workflowStarts_verification;
  "workflowStarts/verification/executionGroups": typeof workflowStarts_verification_executionGroups;
  "workflowStarts/verification/plans": typeof workflowStarts_verification_plans;
  "workflowStarts/verification/results": typeof workflowStarts_verification_results;
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
