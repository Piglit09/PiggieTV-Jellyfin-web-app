using System.Text.Json.Serialization;

namespace Jellyfin.Plugin.PiggieTV.Models;

/// <summary>
/// PiggieTV plugin health response.
/// </summary>
public sealed class PtvStatusResponse
{
    /// <summary>
    /// Gets the plugin release version from the loaded plugin or assembly metadata.
    /// </summary>
    public static string CurrentPluginVersion => Plugin.Instance?.Version?.ToString()
        ?? typeof(Plugin).Assembly.GetName().Version?.ToString()
        ?? "0.0.0.0";

    /// <summary>
    /// Gets or sets a value indicating whether the plugin API is available.
    /// </summary>
    [JsonPropertyName("ok")]
    public bool Ok { get; set; } = true;

    /// <summary>
    /// Gets or sets a value indicating whether the status response contains degraded subsystem data.
    /// </summary>
    [JsonPropertyName("degraded")]
    public bool Degraded { get; set; }

    /// <summary>
    /// Gets or sets a human-readable degraded status error.
    /// </summary>
    [JsonPropertyName("error")]
    public string? Error { get; set; }

    /// <summary>
    /// Gets or sets the plugin name.
    /// </summary>
    [JsonPropertyName("name")]
    public string Name { get; set; } = "PiggieTV";

    /// <summary>
    /// Gets or sets the plugin name.
    /// </summary>
    [JsonPropertyName("pluginName")]
    public string PluginName { get; set; } = "PiggieTV";

    /// <summary>
    /// Gets or sets the plugin version.
    /// </summary>
    [JsonPropertyName("version")]
    public string Version { get; set; } = CurrentPluginVersion;

    /// <summary>
    /// Gets or sets the plugin version.
    /// </summary>
    [JsonPropertyName("pluginVersion")]
    public string PluginVersion { get; set; } = CurrentPluginVersion;

    /// <summary>
    /// Gets or sets the public PiggieTV plugin API version.
    /// </summary>
    [JsonPropertyName("apiVersion")]
    public int ApiVersion { get; set; } = Api.PtvApiRoutes.CurrentVersion;

    /// <summary>
    /// Gets or sets the current versioned API path.
    /// </summary>
    [JsonPropertyName("apiPath")]
    public string ApiPath { get; set; } = $"/{Api.PtvApiRoutes.Root}/{Api.PtvApiRoutes.V1}";

    /// <summary>
    /// Gets or sets the cross-platform PTV Core contract version.
    /// </summary>
    [JsonPropertyName("contractVersion")]
    public string ContractVersion { get; set; } = "1.0";

    /// <summary>
    /// Gets or sets the featured-content cache schema accepted by this plugin.
    /// </summary>
    [JsonPropertyName("cacheVersion")]
    public int CacheVersion { get; set; } = Services.PtvFeaturedContentValidator.FeaturedCacheVersion;

    /// <summary>
    /// Gets or sets the recommendation response schema version.
    /// </summary>
    [JsonPropertyName("recommendationSchemaVersion")]
    public int RecommendationSchemaVersion { get; set; } = 1;

    /// <summary>
    /// Gets or sets the safe diagnostics event/report schema version.
    /// </summary>
    [JsonPropertyName("diagnosticsSchemaVersion")]
    public int DiagnosticsSchemaVersion { get; set; } = 1;

    /// <summary>
    /// Gets or sets a value indicating whether safe remote diagnostics are supported.
    /// </summary>
    [JsonPropertyName("diagnosticsCapable")]
    public bool DiagnosticsCapable { get; set; } = true;

    /// <summary>
    /// Gets or sets server capabilities relevant to PTV Core clients.
    /// </summary>
    [JsonPropertyName("serverCapabilities")]
    public Dictionary<string, bool> ServerCapabilities { get; set; } = new(StringComparer.OrdinalIgnoreCase)
    {
        ["pluginApi"] = true,
        ["featuredContentCache"] = true,
        ["recommendations"] = true,
        ["remoteDiagnostics"] = true
    };

    /// <summary>
    /// Gets or sets feature-flag names supported by this plugin build.
    /// </summary>
    [JsonPropertyName("supportedFeatureFlags")]
    public string[] SupportedFeatureFlags { get; set; } = [
        "featuredContent",
        "featuredContentRefresh",
        "physicalLayoutSnapshot",
        "readingSeriesOverrides",
        "remoteDiagnostics",
        "rows",
        "settings"
    ];

    /// <summary>
    /// Gets or sets optional non-fatal compatibility warnings for clients.
    /// </summary>
    [JsonPropertyName("clientCompatibilityWarnings")]
    public string[] ClientCompatibilityWarnings { get; set; } = [];

    /// <summary>
    /// Gets or sets the server timestamp as Unix epoch milliseconds.
    /// </summary>
    [JsonPropertyName("serverTime")]
    public long ServerTime { get; set; } = DateTimeOffset.UtcNow.ToUnixTimeMilliseconds();

    /// <summary>
    /// Gets or sets the current server UTC timestamp.
    /// </summary>
    [JsonPropertyName("serverTimeUtc")]
    public DateTimeOffset ServerTimeUtc { get; set; } = DateTimeOffset.UtcNow;

    /// <summary>
    /// Gets or sets the cache backend identifier.
    /// </summary>
    [JsonPropertyName("cacheBackend")]
    public string CacheBackend { get; set; } = "plugin-file";

    /// <summary>
    /// Gets or sets the available plugin features.
    /// </summary>
    [JsonPropertyName("features")]
    public string[] Features { get; set; } = [
        "status",
        "featuredContent",
        "featuredContentRefresh",
        "readingSeriesOverrides",
        "settings",
        "rows",
        "integrations",
        "signup",
        "tags",
        "random",
        "remoteDiagnostics",
        "physicalLayoutSnapshot"
    ];

    /// <summary>
    /// Gets or sets a map of feature capabilities for clients that prefer object lookup.
    /// </summary>
    [JsonPropertyName("featureFlags")]
    public Dictionary<string, bool> FeatureFlags { get; set; } = new(StringComparer.OrdinalIgnoreCase)
    {
        ["status"] = true,
        ["featuredContent"] = true,
        ["featuredContentRefresh"] = true,
        ["readingSeriesOverrides"] = true,
        ["settings"] = true,
        ["rows"] = true,
        ["integrations"] = true,
        ["signup"] = true,
        ["tags"] = true,
        ["random"] = true,
        ["remoteDiagnostics"] = true,
        ["physicalLayoutSnapshot"] = true
    };

    /// <summary>
    /// Gets or sets a value indicating whether authenticated users can read featured content.
    /// </summary>
    [JsonPropertyName("canReadFeaturedContent")]
    public bool CanReadFeaturedContent { get; set; } = true;

    /// <summary>
    /// Gets or sets a value indicating whether the current user can write featured content.
    /// </summary>
    [JsonPropertyName("canWriteFeaturedContent")]
    public bool CanWriteFeaturedContent { get; set; }

    /// <summary>
    /// Gets or sets a value indicating whether plugin settings can be safely loaded.
    /// </summary>
    [JsonPropertyName("settingsAvailable")]
    public bool SettingsAvailable { get; set; } = true;

    /// <summary>
    /// Gets or sets a value indicating whether the cache subsystem is healthy.
    /// </summary>
    [JsonPropertyName("cacheHealthy")]
    public bool CacheHealthy { get; set; } = true;

    /// <summary>
    /// Gets or sets a value indicating whether the fixed plugin cache directory exists.
    /// </summary>
    [JsonPropertyName("cachePathExists")]
    public bool CachePathExists { get; set; }

    /// <summary>
    /// Gets or sets a value indicating whether the plugin cache directory is writable.
    /// </summary>
    [JsonPropertyName("cachePathWritable")]
    public bool CachePathWritable { get; set; }

    /// <summary>
    /// Gets or sets the plugin cache directory path.
    /// </summary>
    [JsonPropertyName("cachePath")]
    public string? CachePath { get; set; }

    /// <summary>
    /// Gets or sets the featured-content cache file path.
    /// </summary>
    [JsonPropertyName("cacheFilePath")]
    public string? CacheFilePath { get; set; }

    /// <summary>
    /// Gets or sets the last cache write error.
    /// </summary>
    [JsonPropertyName("cacheWriteError")]
    public string? CacheWriteError { get; set; }

    /// <summary>
    /// Gets or sets the last serialized featured cache payload size in bytes.
    /// </summary>
    [JsonPropertyName("cachePayloadBytes")]
    public long CachePayloadBytes { get; set; }

    /// <summary>
    /// Gets or sets a value indicating whether a featured cache file exists.
    /// </summary>
    [JsonPropertyName("featuredCacheExists")]
    public bool FeaturedCacheExists { get; set; }

    /// <summary>
    /// Gets or sets a value indicating whether the featured cache exists and is fresh.
    /// </summary>
    [JsonPropertyName("featuredCacheFresh")]
    public bool FeaturedCacheFresh { get; set; }

    /// <summary>
    /// Gets or sets the featured cache creation timestamp as Unix epoch milliseconds.
    /// </summary>
    [JsonPropertyName("featuredCacheCreatedAt")]
    public long? FeaturedCacheCreatedAt { get; set; }

    /// <summary>
    /// Gets or sets the featured cache expiry timestamp as Unix epoch milliseconds.
    /// </summary>
    [JsonPropertyName("featuredCacheExpiresAt")]
    public long? FeaturedCacheExpiresAt { get; set; }

    /// <summary>
    /// Gets or sets the maximum accepted cache payload size.
    /// </summary>
    [JsonPropertyName("maxCachePayloadBytes")]
    public int MaxCachePayloadBytes { get; set; } = Jellyfin.Plugin.PiggieTV.Services.PtvFeaturedContentValidator.GetMaxDocumentBytes();

    /// <summary>
    /// Gets or sets the featured-content cache status.
    /// </summary>
    [JsonPropertyName("featuredContent")]
    public PtvFeaturedContentStatus FeaturedContent { get; set; } = new();

    /// <summary>
    /// Gets or sets the content cache subsystem status.
    /// </summary>
    [JsonPropertyName("contentCacheStatus")]
    public PtvContentCacheStatus ContentCacheStatus { get; set; } = new();

    /// <summary>
    /// Gets or sets a value indicating whether a server-side featured-content refresh is currently running.
    /// </summary>
    [JsonPropertyName("refreshInProgress")]
    public bool RefreshInProgress { get; set; }

    /// <summary>
    /// Gets or sets the last refresh start timestamp as Unix epoch milliseconds.
    /// </summary>
    [JsonPropertyName("lastRefreshStartedAt")]
    public long? LastRefreshStartedAt { get; set; }

    /// <summary>
    /// Gets or sets the last refresh completion timestamp as Unix epoch milliseconds.
    /// </summary>
    [JsonPropertyName("lastRefreshCompletedAt")]
    public long? LastRefreshCompletedAt { get; set; }

    /// <summary>
    /// Gets or sets the last refresh duration in milliseconds.
    /// </summary>
    [JsonPropertyName("lastRefreshDurationMs")]
    public long? LastRefreshDurationMs { get; set; }

    /// <summary>
    /// Gets or sets the last refresh error.
    /// </summary>
    [JsonPropertyName("lastRefreshError")]
    public string? LastRefreshError { get; set; }

    /// <summary>
    /// Gets or sets the last non-fatal refresh warning.
    /// </summary>
    [JsonPropertyName("lastRefreshWarning")]
    public string? LastRefreshWarning { get; set; }

    /// <summary>
    /// Gets or sets the next scheduled refresh timestamp as Unix epoch milliseconds.
    /// </summary>
    [JsonPropertyName("nextRefreshAt")]
    public long? NextRefreshAt { get; set; }

    /// <summary>
    /// Gets or sets the optional TMDb metadata enrichment status.
    /// </summary>
    [JsonPropertyName("tmdbMetadata")]
    public PtvTmdbMetadataStatus TmdbMetadata { get; set; } = new();

    /// <summary>
    /// Gets or sets the TMDb metadata subsystem status.
    /// </summary>
    [JsonPropertyName("tmdbMetadataStatus")]
    public PtvTmdbMetadataStatus TmdbMetadataStatus { get; set; } = new();

    /// <summary>
    /// Gets or sets integration route discovery for dashboard diagnostics.
    /// </summary>
    [JsonPropertyName("integrations")]
    public PtvStatusIntegrations Integrations { get; set; } = PtvStatusIntegrations.Create();

    /// <summary>
    /// Gets or sets redacted native signup diagnostics for dashboard debug reports.
    /// </summary>
    [JsonPropertyName("signup")]
    public PtvStatusSignup Signup { get; set; } = PtvStatusSignup.Create();

    /// <summary>
    /// Creates a status response from a stored document.
    /// </summary>
    /// <param name="storeStatus">Featured-content store status.</param>
    /// <param name="canWriteFeaturedContent">Whether the current user can write featured content.</param>
    /// <param name="refreshStatus">Featured-content refresh worker status.</param>
    /// <param name="tmdbMetadata">TMDb metadata enrichment status.</param>
    /// <returns>Status response.</returns>
    public static PtvStatusResponse FromStoreStatus(
        PtvFeaturedContentStoreStatus storeStatus,
        bool canWriteFeaturedContent,
        PtvFeaturedContentRefreshStatus? refreshStatus = null,
        PtvTmdbMetadataStatus? tmdbMetadata = null)
    {
        var now = DateTimeOffset.UtcNow;
        var pluginVersion = CurrentPluginVersion;
        refreshStatus ??= new PtvFeaturedContentRefreshStatus();

        return new PtvStatusResponse
        {
            CanWriteFeaturedContent = canWriteFeaturedContent,
            CacheFilePath = storeStatus.CacheFilePath,
            CacheHealthy = string.IsNullOrWhiteSpace(storeStatus.CacheWriteError),
            CachePath = storeStatus.CachePath,
            CachePathExists = storeStatus.CachePathExists,
            CachePathWritable = storeStatus.CachePathWritable,
            CachePayloadBytes = storeStatus.CachePayloadBytes,
            CacheWriteError = storeStatus.CacheWriteError,
            ContentCacheStatus = PtvContentCacheStatus.FromStoreStatus(storeStatus),
            FeaturedCacheCreatedAt = storeStatus.FeaturedCacheCreatedAt,
            FeaturedCacheExists = storeStatus.FeaturedCacheExists,
            FeaturedCacheExpiresAt = storeStatus.FeaturedCacheExpiresAt,
            FeaturedCacheFresh = storeStatus.FeaturedCacheFresh,
            FeaturedContent = PtvFeaturedContentStatus.FromDocument(storeStatus.Document),
            LastRefreshCompletedAt = refreshStatus.LastRefreshCompletedAt,
            LastRefreshDurationMs = refreshStatus.LastRefreshDurationMs,
            LastRefreshError = refreshStatus.LastRefreshError,
            LastRefreshStartedAt = refreshStatus.LastRefreshStartedAt,
            LastRefreshWarning = refreshStatus.LastRefreshWarning,
            MaxCachePayloadBytes = Jellyfin.Plugin.PiggieTV.Services.PtvFeaturedContentValidator.GetMaxDocumentBytes(),
            NextRefreshAt = refreshStatus.NextRefreshAt ?? storeStatus.FeaturedCacheExpiresAt,
            PluginVersion = pluginVersion,
            RefreshInProgress = refreshStatus.RefreshInProgress,
            ServerTime = now.ToUnixTimeMilliseconds(),
            ServerTimeUtc = now,
            TmdbMetadata = tmdbMetadata ?? new PtvTmdbMetadataStatus(),
            TmdbMetadataStatus = tmdbMetadata ?? new PtvTmdbMetadataStatus(),
            Version = pluginVersion
        };
    }
}

/// <summary>
/// PiggieTV integration route discovery for dashboard diagnostics.
/// </summary>
public sealed class PtvStatusIntegrations
{
    /// <summary>
    /// Gets or sets *Arr calendar route status.
    /// </summary>
    [JsonPropertyName("arrCalendar")]
    public PtvIntegrationRouteStatus ArrCalendar { get; set; } = PtvIntegrationRouteStatus.CreateArrCalendar(false);

    /// <summary>
    /// Creates default integration route discovery.
    /// </summary>
    /// <returns>Integration route discovery.</returns>
    public static PtvStatusIntegrations Create()
    {
        return new PtvStatusIntegrations
        {
            ArrCalendar = PtvIntegrationRouteStatus.CreateArrCalendar(true)
        };
    }
}

/// <summary>
/// Redacted PiggieTV native signup diagnostics for status/debug payloads.
/// </summary>
public sealed class PtvStatusSignup
{
    /// <summary>Gets or sets whether native PiggieTV signup is enabled.</summary>
    [JsonPropertyName("enabled")]
    public bool Enabled { get; set; }

    /// <summary>Gets or sets whether signup requires email verification.</summary>
    [JsonPropertyName("emailRequired")]
    public bool EmailRequired { get; set; } = true;

    /// <summary>Gets or sets whether SMTP/email delivery is enabled.</summary>
    [JsonPropertyName("emailEnabled")]
    public bool EmailEnabled { get; set; }

    /// <summary>Gets or sets whether the email engine has the minimum required settings.</summary>
    [JsonPropertyName("emailConfigured")]
    public bool EmailConfigured { get; set; }

    /// <summary>Gets or sets whether an SMTP host is configured.</summary>
    [JsonPropertyName("smtpHostConfigured")]
    public bool SmtpHostConfigured { get; set; }

    /// <summary>Gets or sets SMTP port for diagnostics.</summary>
    [JsonPropertyName("smtpPort")]
    public int SmtpPort { get; set; }

    /// <summary>Gets or sets whether SMTP SSL/TLS is enabled.</summary>
    [JsonPropertyName("useSsl")]
    public bool UseSsl { get; set; }

    /// <summary>Gets or sets whether an SMTP username is configured.</summary>
    [JsonPropertyName("smtpUsernameConfigured")]
    public bool SmtpUsernameConfigured { get; set; }

    /// <summary>Gets or sets whether an SMTP password is configured.</summary>
    [JsonPropertyName("smtpPasswordConfigured")]
    public bool SmtpPasswordConfigured { get; set; }

    /// <summary>Gets or sets whether a From address is configured.</summary>
    [JsonPropertyName("fromAddressConfigured")]
    public bool FromAddressConfigured { get; set; }

    /// <summary>Gets or sets whether a branded email logo URL is configured.</summary>
    [JsonPropertyName("logoUrlConfigured")]
    public bool LogoUrlConfigured { get; set; }

    /// <summary>Gets or sets the sender domain only, not the full address.</summary>
    [JsonPropertyName("fromDomain")]
    public string? FromDomain { get; set; }

    /// <summary>Gets or sets reset-code lifetime in minutes.</summary>
    [JsonPropertyName("resetCodeMinutes")]
    public int ResetCodeMinutes { get; set; }

    /// <summary>Gets or sets verification-link lifetime in minutes.</summary>
    [JsonPropertyName("verificationLinkMinutes")]
    public int VerificationLinkMinutes { get; set; }

    /// <summary>Gets or sets the default policy preset id.</summary>
    [JsonPropertyName("defaultPolicyPresetId")]
    public string DefaultPolicyPresetId { get; set; } = "standard";

    /// <summary>Gets or sets the number of explicit default library folders.</summary>
    [JsonPropertyName("defaultEnabledFolderCount")]
    public int DefaultEnabledFolderCount { get; set; }

    /// <summary>Gets or sets configured policy preset count.</summary>
    [JsonPropertyName("policyPresetCount")]
    public int PolicyPresetCount { get; set; }

    /// <summary>Gets or sets configured invite count.</summary>
    [JsonPropertyName("inviteCount")]
    public int InviteCount { get; set; }

    /// <summary>Gets or sets active invite count.</summary>
    [JsonPropertyName("activeInviteCount")]
    public int ActiveInviteCount { get; set; }

    /// <summary>Gets or sets locked invite count.</summary>
    [JsonPropertyName("lockedInviteCount")]
    public int LockedInviteCount { get; set; }

    /// <summary>Gets or sets native signup-created user count.</summary>
    [JsonPropertyName("nativeUserCount")]
    public int NativeUserCount { get; set; }

    /// <summary>Gets or sets active pending verification count.</summary>
    [JsonPropertyName("pendingVerificationCount")]
    public int PendingVerificationCount { get; set; }

    /// <summary>Gets or sets expired pending verification count.</summary>
    [JsonPropertyName("expiredPendingVerificationCount")]
    public int ExpiredPendingVerificationCount { get; set; }

    /// <summary>Gets or sets active pending password-reset code count.</summary>
    [JsonPropertyName("pendingResetCount")]
    public int PendingResetCount { get; set; }

    /// <summary>Gets or sets expired pending password-reset code count.</summary>
    [JsonPropertyName("expiredPendingResetCount")]
    public int ExpiredPendingResetCount { get; set; }

    /// <summary>Gets or sets active public signup/reset rate-limit bucket count.</summary>
    [JsonPropertyName("activeRateLimitCount")]
    public int ActiveRateLimitCount { get; set; }

    /// <summary>Gets or sets latest native signup creation timestamp.</summary>
    [JsonPropertyName("lastNativeUserCreatedAtUtc")]
    public DateTimeOffset? LastNativeUserCreatedAtUtc { get; set; }

    /// <summary>Gets or sets next pending verification expiration timestamp.</summary>
    [JsonPropertyName("nextVerificationExpiresAtUtc")]
    public DateTimeOffset? NextVerificationExpiresAtUtc { get; set; }

    /// <summary>Gets or sets next pending reset-code expiration timestamp.</summary>
    [JsonPropertyName("nextResetCodeExpiresAtUtc")]
    public DateTimeOffset? NextResetCodeExpiresAtUtc { get; set; }

    /// <summary>Gets or sets signup API route discovery.</summary>
    [JsonPropertyName("routes")]
    public PtvSignupRouteStatus Routes { get; set; } = PtvSignupRouteStatus.Create();

    /// <summary>
    /// Creates default redacted signup diagnostics.
    /// </summary>
    /// <returns>Default signup diagnostics.</returns>
    public static PtvStatusSignup Create() => new()
    {
        Routes = PtvSignupRouteStatus.Create()
    };

    /// <summary>
    /// Creates redacted signup diagnostics from saved settings.
    /// </summary>
    /// <param name="settings">Native signup settings.</param>
    /// <returns>Redacted signup diagnostics.</returns>
    public static PtvStatusSignup Create(Jellyfin.Plugin.PiggieTV.Configuration.SignupSettings settings)
    {
        var now = DateTimeOffset.UtcNow;
        var email = settings.EmailSettings;
        var pendingVerifications = settings.PendingVerifications ?? [];
        var resetCodes = settings.PasswordResetCodes ?? [];
        var invites = settings.Invites ?? [];
        var rateLimits = settings.RateLimits ?? [];
        var activePendingVerifications = pendingVerifications
            .Where(pending => pending.ExpiresAtUtc > now)
            .ToList();
        var activeResetCodes = resetCodes
            .Where(code => code.UsedAtUtc is null && code.ExpiresAtUtc > now)
            .ToList();
        var activeInvites = invites.Count(invite =>
            !invite.Disabled
            && (invite.ExpiresAtUtc is null || invite.ExpiresAtUtc > now)
            && (invite.MaxUses <= 0 || (invite.UsageRecords?.Count ?? 0) < invite.MaxUses)
            && (invite.LockedUntilUtc is null || invite.LockedUntilUtc <= now));

        return new PtvStatusSignup
        {
            ActiveInviteCount = activeInvites,
            ActiveRateLimitCount = rateLimits.Count(record =>
                (record.LockedUntilUtc is not null && record.LockedUntilUtc > now)
                || record.WindowStartedAtUtc > now.AddHours(-1)),
            DefaultEnabledFolderCount = settings.DefaultEnabledFolderIds?.Count ?? 0,
            DefaultPolicyPresetId = settings.DefaultPolicyPresetId,
            EmailConfigured = !string.IsNullOrWhiteSpace(email.SmtpHost)
                && !string.IsNullOrWhiteSpace(email.FromAddress)
                && !string.IsNullOrWhiteSpace(email.Password),
            EmailEnabled = email.Enabled,
            Enabled = settings.Enabled,
            ExpiredPendingResetCount = resetCodes.Count(code => code.UsedAtUtc is null && code.ExpiresAtUtc <= now),
            ExpiredPendingVerificationCount = pendingVerifications.Count(pending => pending.ExpiresAtUtc <= now),
            FromAddressConfigured = !string.IsNullOrWhiteSpace(email.FromAddress),
            FromDomain = GetEmailDomain(email.FromAddress),
            InviteCount = invites.Count,
            LastNativeUserCreatedAtUtc = settings.Users?.Count > 0
                ? settings.Users.Max(user => user.CreatedAtUtc)
                : null,
            LockedInviteCount = invites.Count(invite => invite.LockedUntilUtc > now),
            LogoUrlConfigured = !string.IsNullOrWhiteSpace(email.LogoUrl),
            NativeUserCount = settings.Users?.Count ?? 0,
            NextResetCodeExpiresAtUtc = activeResetCodes.Count > 0
                ? activeResetCodes.Min(code => code.ExpiresAtUtc)
                : null,
            NextVerificationExpiresAtUtc = activePendingVerifications.Count > 0
                ? activePendingVerifications.Min(pending => pending.ExpiresAtUtc)
                : null,
            PendingResetCount = activeResetCodes.Count,
            PendingVerificationCount = activePendingVerifications.Count,
            PolicyPresetCount = settings.PolicyPresets?.Count ?? 0,
            ResetCodeMinutes = email.ResetCodeMinutes,
            Routes = PtvSignupRouteStatus.Create(),
            SmtpHostConfigured = !string.IsNullOrWhiteSpace(email.SmtpHost),
            SmtpPasswordConfigured = !string.IsNullOrWhiteSpace(email.Password),
            SmtpPort = email.SmtpPort,
            SmtpUsernameConfigured = !string.IsNullOrWhiteSpace(email.Username),
            UseSsl = email.UseSsl,
            VerificationLinkMinutes = email.VerificationLinkMinutes
        };
    }

    private static string? GetEmailDomain(string? email)
    {
        if (string.IsNullOrWhiteSpace(email))
        {
            return null;
        }

        var atIndex = email.LastIndexOf('@');
        if (atIndex < 0 || atIndex >= email.Length - 1)
        {
            return null;
        }

        return email[(atIndex + 1)..].Trim().ToLowerInvariant();
    }
}

/// <summary>
/// PiggieTV signup route discovery.
/// </summary>
public sealed class PtvSignupRouteStatus
{
    /// <summary>Gets or sets whether signup routes are available in this plugin build.</summary>
    [JsonPropertyName("available")]
    public bool Available { get; set; } = true;

    /// <summary>Gets or sets public create-user route.</summary>
    [JsonPropertyName("createUser")]
    public string CreateUser { get; set; } = "/Ptv/v1/signup/create-user";

    /// <summary>Gets or sets public email verification route.</summary>
    [JsonPropertyName("verifyEmail")]
    public string VerifyEmail { get; set; } = "/Ptv/v1/signup/verify-email";

    /// <summary>Gets or sets public password reset request route.</summary>
    [JsonPropertyName("passwordResetRequest")]
    public string PasswordResetRequest { get; set; } = "/Ptv/v1/signup/password-reset/request";

    /// <summary>Gets or sets public password reset confirmation route.</summary>
    [JsonPropertyName("passwordResetConfirm")]
    public string PasswordResetConfirm { get; set; } = "/Ptv/v1/signup/password-reset/confirm";

    /// <summary>Gets or sets admin signup settings route.</summary>
    [JsonPropertyName("adminSettings")]
    public string AdminSettings { get; set; } = "/Ptv/v1/signup/admin/settings";

    /// <summary>Gets or sets admin test email route.</summary>
    [JsonPropertyName("adminTestEmail")]
    public string AdminTestEmail { get; set; } = "/Ptv/v1/signup/admin/email/test";

    /// <summary>Gets or sets supported methods by route id.</summary>
    [JsonPropertyName("methods")]
    public Dictionary<string, string[]> Methods { get; set; } = new(StringComparer.OrdinalIgnoreCase);

    /// <summary>
    /// Creates route discovery.
    /// </summary>
    /// <returns>Signup route discovery.</returns>
    public static PtvSignupRouteStatus Create() => new()
    {
        Methods = new Dictionary<string, string[]>(StringComparer.OrdinalIgnoreCase)
        {
            ["createUser"] = ["POST"],
            ["verifyEmail"] = ["POST"],
            ["passwordResetRequest"] = ["POST"],
            ["passwordResetConfirm"] = ["POST"],
            ["adminSettings"] = ["GET", "POST"],
            ["adminTestEmail"] = ["POST"]
        }
    };
}

/// <summary>
/// Single integration route status.
/// </summary>
public sealed class PtvIntegrationRouteStatus
{
    /// <summary>
    /// Gets or sets a value indicating whether the integration is enabled in saved settings.
    /// </summary>
    [JsonPropertyName("enabled")]
    public bool Enabled { get; set; }

    /// <summary>
    /// Gets or sets a value indicating whether the plugin exposes the test route in this build.
    /// </summary>
    [JsonPropertyName("testRouteAvailable")]
    public bool TestRouteAvailable { get; set; }

    /// <summary>
    /// Gets or sets the canonical plugin test route.
    /// </summary>
    [JsonPropertyName("canonicalRoute")]
    public string CanonicalRoute { get; set; } = string.Empty;

    /// <summary>
    /// Gets or sets route aliases supported for backwards compatibility.
    /// </summary>
    [JsonPropertyName("aliases")]
    public string[] Aliases { get; set; } = [];

    /// <summary>
    /// Gets or sets HTTP methods supported by the route.
    /// </summary>
    [JsonPropertyName("methods")]
    public string[] Methods { get; set; } = [];

    /// <summary>
    /// Creates *Arr calendar route status.
    /// </summary>
    /// <param name="enabled">Whether at least one *Arr service can provide calendar data.</param>
    /// <returns>*Arr calendar route status.</returns>
    public static PtvIntegrationRouteStatus CreateArrCalendar(bool enabled)
    {
        return new PtvIntegrationRouteStatus
        {
            Aliases = ["/Ptv/v1/integrations/arr/calendar"],
            CanonicalRoute = "/Ptv/v1/calendar",
            Enabled = enabled,
            Methods = ["GET"],
            TestRouteAvailable = true
        };
    }
}
