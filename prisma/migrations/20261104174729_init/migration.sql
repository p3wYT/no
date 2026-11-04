-- CreateEnum
CREATE TYPE "Platform" AS ENUM ('TIKTOK', 'INSTAGRAM', 'YOUTUBE');

-- CreateEnum
CREATE TYPE "AccountStatus" AS ENUM ('CONNECTED', 'TOKEN_EXPIRED', 'REVOKED', 'ERROR', 'LIMITED');

-- CreateEnum
CREATE TYPE "ExecutionMode" AS ENUM ('AUTOMATIC', 'APPROVAL_REQUIRED');

-- CreateEnum
CREATE TYPE "ScheduleMode" AS ENUM ('IMMEDIATE', 'FIXED_DELAY', 'SCHEDULED_WINDOW', 'SPECIFIC_TIME', 'QUEUE');

-- CreateEnum
CREATE TYPE "CaptionMode" AS ENUM ('KEEP_ORIGINAL', 'CUSTOM', 'TEMPLATE');

-- CreateEnum
CREATE TYPE "PublishStatus" AS ENUM ('PENDING_APPROVAL', 'AWAITING_ASSET', 'SCHEDULED', 'QUEUED', 'PROCESSING', 'UPLOADING', 'PUBLISHING', 'PUBLISHED', 'FAILED', 'CANCELLED', 'DRAFT_HANDOFF');

-- CreateEnum
CREATE TYPE "AssetSource" AS ENUM ('USER_UPLOAD', 'MATCHED_UPLOAD', 'AUTHORIZED_ENDPOINT');

-- CreateEnum
CREATE TYPE "NotificationType" AS ENUM ('ACCOUNT_DISCONNECTED', 'TOKEN_REFRESH_FAILED', 'ASSET_MISSING', 'APPROVAL_REQUIRED', 'PUBLISH_FAILED', 'PUBLISH_SUCCEEDED', 'RULE_PAUSED');

-- CreateTable
CREATE TABLE "User" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "passwordHash" TEXT NOT NULL,
    "name" TEXT,
    "emailVerified" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "onboardingStep" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Session" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "userAgent" TEXT,
    "ip" TEXT,

    CONSTRAINT "Session_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "UserPreferences" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "timezone" TEXT NOT NULL DEFAULT 'UTC',
    "theme" TEXT NOT NULL DEFAULT 'system',
    "emailNotifications" BOOLEAN NOT NULL DEFAULT false,
    "notifyOnPublish" BOOLEAN NOT NULL DEFAULT true,
    "notifyOnFailure" BOOLEAN NOT NULL DEFAULT true,
    "notifyOnApproval" BOOLEAN NOT NULL DEFAULT true,
    "notifyOnDisconnect" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "UserPreferences_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SocialAccount" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "platform" "Platform" NOT NULL,
    "providerAccountId" TEXT NOT NULL,
    "username" TEXT,
    "displayName" TEXT,
    "avatarUrl" TEXT,
    "accessTokenEnc" TEXT,
    "refreshTokenEnc" TEXT,
    "tokenExpiresAt" TIMESTAMP(3),
    "scopes" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "status" "AccountStatus" NOT NULL DEFAULT 'CONNECTED',
    "canPublish" BOOLEAN NOT NULL DEFAULT false,
    "statusDetail" TEXT,
    "pollIntervalSec" INTEGER NOT NULL DEFAULT 900,
    "monitoringOn" BOOLEAN NOT NULL DEFAULT true,
    "lastCheckedAt" TIMESTAMP(3),
    "nextCheckAt" TIMESTAMP(3),
    "baselineAt" TIMESTAMP(3),
    "lastError" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SocialAccount_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "VideoAsset" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "source" "AssetSource" NOT NULL DEFAULT 'USER_UPLOAD',
    "title" TEXT,
    "description" TEXT,
    "storageKey" TEXT,
    "thumbnailKey" TEXT,
    "originalName" TEXT,
    "mimeType" TEXT,
    "sizeBytes" BIGINT,
    "contentHash" TEXT,
    "durationSec" DOUBLE PRECISION,
    "width" INTEGER,
    "height" INTEGER,
    "aspectRatio" TEXT,
    "uploadComplete" BOOLEAN NOT NULL DEFAULT false,
    "probed" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "VideoAsset_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DetectedPost" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "platform" "Platform" NOT NULL,
    "providerPostId" TEXT NOT NULL,
    "caption" TEXT,
    "title" TEXT,
    "permalink" TEXT,
    "thumbnailUrl" TEXT,
    "durationSec" DOUBLE PRECISION,
    "width" INTEGER,
    "height" INTEGER,
    "publishedAt" TIMESTAMP(3),
    "originatedByJobId" TEXT,
    "isRepostArtifact" BOOLEAN NOT NULL DEFAULT false,
    "matchedAssetId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DetectedPost_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Automation" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT false,
    "sourcePlatform" "Platform" NOT NULL,
    "sourceAccountId" TEXT NOT NULL,
    "executionMode" "ExecutionMode" NOT NULL DEFAULT 'APPROVAL_REQUIRED',
    "scheduleMode" "ScheduleMode" NOT NULL DEFAULT 'IMMEDIATE',
    "delaySeconds" INTEGER NOT NULL DEFAULT 0,
    "scheduleConfig" JSONB,
    "conditions" JSONB,
    "baselineAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "lastRunAt" TIMESTAMP(3),

    CONSTRAINT "Automation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AutomationTarget" (
    "id" TEXT NOT NULL,
    "automationId" TEXT NOT NULL,
    "platform" "Platform" NOT NULL,
    "accountId" TEXT NOT NULL,
    "captionMode" "CaptionMode" NOT NULL DEFAULT 'KEEP_ORIGINAL',
    "captionConfig" JSONB,
    "visibility" TEXT NOT NULL DEFAULT 'public',
    "extraDelaySec" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "AutomationTarget_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PublishJob" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "automationId" TEXT,
    "detectedPostId" TEXT,
    "assetId" TEXT,
    "destinationAccountId" TEXT NOT NULL,
    "destinationPlatform" "Platform" NOT NULL,
    "status" "PublishStatus" NOT NULL DEFAULT 'SCHEDULED',
    "scheduledAt" TIMESTAMP(3),
    "startedAt" TIMESTAMP(3),
    "publishedAt" TIMESTAMP(3),
    "resolvedCaption" TEXT,
    "resolvedTitle" TEXT,
    "resolvedDescription" TEXT,
    "visibility" TEXT NOT NULL DEFAULT 'public',
    "providerPostId" TEXT,
    "publishedUrl" TEXT,
    "idempotencyKey" TEXT NOT NULL,
    "providerUploadRef" TEXT,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "maxAttempts" INTEGER NOT NULL DEFAULT 5,
    "lastError" TEXT,
    "nextRetryAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PublishJob_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ActivityEvent" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "jobId" TEXT,
    "kind" TEXT NOT NULL,
    "message" TEXT NOT NULL,
    "meta" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ActivityEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Notification" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "type" "NotificationType" NOT NULL,
    "title" TEXT NOT NULL,
    "body" TEXT,
    "readAt" TIMESTAMP(3),
    "meta" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Notification_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CaptionTemplate" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "platform" "Platform",
    "body" TEXT NOT NULL,
    "isDefault" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CaptionTemplate_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");

-- CreateIndex
CREATE UNIQUE INDEX "Session_tokenHash_key" ON "Session"("tokenHash");

-- CreateIndex
CREATE INDEX "Session_userId_idx" ON "Session"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "UserPreferences_userId_key" ON "UserPreferences"("userId");

-- CreateIndex
CREATE INDEX "SocialAccount_userId_idx" ON "SocialAccount"("userId");

-- CreateIndex
CREATE INDEX "SocialAccount_monitoringOn_nextCheckAt_idx" ON "SocialAccount"("monitoringOn", "nextCheckAt");

-- CreateIndex
CREATE UNIQUE INDEX "SocialAccount_userId_platform_providerAccountId_key" ON "SocialAccount"("userId", "platform", "providerAccountId");

-- CreateIndex
CREATE INDEX "VideoAsset_userId_idx" ON "VideoAsset"("userId");

-- CreateIndex
CREATE INDEX "VideoAsset_userId_contentHash_idx" ON "VideoAsset"("userId", "contentHash");

-- CreateIndex
CREATE UNIQUE INDEX "DetectedPost_originatedByJobId_key" ON "DetectedPost"("originatedByJobId");

-- CreateIndex
CREATE INDEX "DetectedPost_userId_idx" ON "DetectedPost"("userId");

-- CreateIndex
CREATE INDEX "DetectedPost_platform_publishedAt_idx" ON "DetectedPost"("platform", "publishedAt");

-- CreateIndex
CREATE UNIQUE INDEX "DetectedPost_accountId_providerPostId_key" ON "DetectedPost"("accountId", "providerPostId");

-- CreateIndex
CREATE INDEX "Automation_userId_idx" ON "Automation"("userId");

-- CreateIndex
CREATE INDEX "Automation_enabled_sourceAccountId_idx" ON "Automation"("enabled", "sourceAccountId");

-- CreateIndex
CREATE INDEX "AutomationTarget_automationId_idx" ON "AutomationTarget"("automationId");

-- CreateIndex
CREATE UNIQUE INDEX "AutomationTarget_automationId_accountId_key" ON "AutomationTarget"("automationId", "accountId");

-- CreateIndex
CREATE UNIQUE INDEX "PublishJob_idempotencyKey_key" ON "PublishJob"("idempotencyKey");

-- CreateIndex
CREATE INDEX "PublishJob_userId_idx" ON "PublishJob"("userId");

-- CreateIndex
CREATE INDEX "PublishJob_status_scheduledAt_idx" ON "PublishJob"("status", "scheduledAt");

-- CreateIndex
CREATE INDEX "PublishJob_destinationAccountId_idx" ON "PublishJob"("destinationAccountId");

-- CreateIndex
CREATE INDEX "ActivityEvent_userId_createdAt_idx" ON "ActivityEvent"("userId", "createdAt");

-- CreateIndex
CREATE INDEX "Notification_userId_readAt_idx" ON "Notification"("userId", "readAt");

-- CreateIndex
CREATE INDEX "CaptionTemplate_userId_idx" ON "CaptionTemplate"("userId");

-- AddForeignKey
ALTER TABLE "Session" ADD CONSTRAINT "Session_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UserPreferences" ADD CONSTRAINT "UserPreferences_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SocialAccount" ADD CONSTRAINT "SocialAccount_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VideoAsset" ADD CONSTRAINT "VideoAsset_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DetectedPost" ADD CONSTRAINT "DetectedPost_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DetectedPost" ADD CONSTRAINT "DetectedPost_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "SocialAccount"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DetectedPost" ADD CONSTRAINT "DetectedPost_matchedAssetId_fkey" FOREIGN KEY ("matchedAssetId") REFERENCES "VideoAsset"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Automation" ADD CONSTRAINT "Automation_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Automation" ADD CONSTRAINT "Automation_sourceAccountId_fkey" FOREIGN KEY ("sourceAccountId") REFERENCES "SocialAccount"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AutomationTarget" ADD CONSTRAINT "AutomationTarget_automationId_fkey" FOREIGN KEY ("automationId") REFERENCES "Automation"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AutomationTarget" ADD CONSTRAINT "AutomationTarget_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "SocialAccount"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PublishJob" ADD CONSTRAINT "PublishJob_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PublishJob" ADD CONSTRAINT "PublishJob_automationId_fkey" FOREIGN KEY ("automationId") REFERENCES "Automation"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PublishJob" ADD CONSTRAINT "PublishJob_detectedPostId_fkey" FOREIGN KEY ("detectedPostId") REFERENCES "DetectedPost"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PublishJob" ADD CONSTRAINT "PublishJob_assetId_fkey" FOREIGN KEY ("assetId") REFERENCES "VideoAsset"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PublishJob" ADD CONSTRAINT "PublishJob_destinationAccountId_fkey" FOREIGN KEY ("destinationAccountId") REFERENCES "SocialAccount"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ActivityEvent" ADD CONSTRAINT "ActivityEvent_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ActivityEvent" ADD CONSTRAINT "ActivityEvent_jobId_fkey" FOREIGN KEY ("jobId") REFERENCES "PublishJob"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Notification" ADD CONSTRAINT "Notification_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CaptionTemplate" ADD CONSTRAINT "CaptionTemplate_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
