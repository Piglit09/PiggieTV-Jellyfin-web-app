using Jellyfin.Data.Enums;
using MediaBrowser.Controller.Entities;
using MediaBrowser.Controller.Library;

namespace Jellyfin.Plugin.PiggieTV.Services;

/// <summary>A completeable page from a recursive Jellyfin CollectionFolder query.</summary>
internal sealed record PtvHomeLibraryCandidatePage(IReadOnlyList<BaseItem> Items, int TotalCount);

/// <summary>One-generation, exact-library candidate authority for configured Home rows.</summary>
internal sealed class PtvHomeLibraryCandidates
{
    private const int PageSize = 200;
    private const int MaximumPages = 1000;
    private readonly Func<Guid, string[], int, int, PtvHomeLibraryCandidatePage> _query;
    private readonly Dictionary<string, IReadOnlyList<BaseItem>> _memo = new(StringComparer.Ordinal);

    internal PtvHomeLibraryCandidates(ILibraryManager libraryManager)
        : this((id, types, start, limit) =>
        {
            var result = libraryManager.QueryItems(new InternalItemsQuery
            {
                AncestorIds = [id],
                Recursive = true,
                IncludeItemTypes = types.Select(type => Enum.Parse<BaseItemKind>(type, false)).ToArray(),
                StartIndex = start,
                Limit = limit,
                EnableTotalRecordCount = true
            });
            return new PtvHomeLibraryCandidatePage(result.Items, result.TotalRecordCount);
        })
    {
    }

    internal PtvHomeLibraryCandidates(Func<Guid, string[], int, int, PtvHomeLibraryCandidatePage> query)
    {
        _query = query;
    }

    /// <summary>Returns only a complete, deduplicated library pool; never a partial result.</summary>
    internal IReadOnlyList<BaseItem> GetCandidates(Guid libraryId, IReadOnlyCollection<string> types, CancellationToken cancellationToken)
    {
        if (libraryId == Guid.Empty || types.Count == 0) throw new InvalidOperationException("Invalid owned library query.");
        var typeSet = types.Distinct(StringComparer.Ordinal).OrderBy(type => type, StringComparer.Ordinal).ToArray();
        var key = $"{libraryId:N}:{string.Join(',', typeSet)}";
        if (_memo.TryGetValue(key, out var cached)) return cached;

        var items = new List<BaseItem>();
        var ids = new HashSet<Guid>();
        int? expectedTotal = null;
        var offset = 0;
        for (var pageNumber = 0; pageNumber < MaximumPages; pageNumber++)
        {
            cancellationToken.ThrowIfCancellationRequested();
            PtvHomeLibraryCandidatePage page;
            try
            {
                page = _query(libraryId, typeSet, offset, PageSize);
            }
            catch (Exception ex) when (ex is not OperationCanceledException)
            {
                throw new InvalidOperationException("Owned library query failed.", ex);
            }

            if (page.TotalCount < 0 || page.Items.Count > PageSize || (expectedTotal is not null && page.TotalCount != expectedTotal))
            {
                throw new InvalidOperationException("Owned library pagination changed.");
            }

            expectedTotal ??= page.TotalCount;
            if (page.Items.Count == 0 && offset < expectedTotal)
            {
                throw new InvalidOperationException("Owned library pagination was incomplete.");
            }

            foreach (var item in page.Items)
            {
                if (item.Id != Guid.Empty && ids.Add(item.Id)) items.Add(item);
            }

            offset += page.Items.Count;
            if (offset > expectedTotal) throw new InvalidOperationException("Owned library pagination exceeded its total.");
            if (offset == expectedTotal)
            {
                _memo[key] = items;
                return items;
            }
        }

        throw new InvalidOperationException("Owned library pagination exceeded its page limit.");
    }
}
