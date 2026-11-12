const mangayomiSources = [{
    "name": "Luscious",
    "lang": "en",
    "baseUrl": "https://www.luscious.net",
    "apiUrl": "https://members.luscious.net/graphql/nobatch/",
    "iconUrl": "https://www.luscious.net/favicon.ico",
    "typeSource": "single",
    "itemType": 0,
    "version": "1.2.0",
    "isNsfw": true,
    "sourceCodeUrl": "https://raw.githubusercontent.com/kingsiruss/mangayomi-extensions/main/javascript/manga/src/en/luscious.js",
    "sourceCodeLanguage": 1
}];

class DefaultExtension extends MProvider {
    getHeaders() {
        return {
            "Referer": "https://members.luscious.net/",
            "Content-Type": "application/json",
            "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
            "Accept": "application/json",
            "Origin": "https://members.luscious.net"
        };
    }

    async graphql(operationName, variables = {}) {
        const queries = {
            AlbumListWithPeek: `query AlbumListWithPeek($input: AlbumListInput!) {
                album {
                    list(input: $input) {
                        info { page has_next_page total_items }
                        items { id title url cover { url } }
                    }
                }
            }`,
            AlbumGet: `query AlbumGet($id: ID!) {
                album { get(id: $id) { ... on Album { id title description number_of_pictures } } }
            }`,
            AlbumListOwnPictures: `query AlbumListOwnPictures($input: PictureListInput!) {
                picture {
                    list(input: $input) {
                        items { 
                            url_to_original 
                            url_to_video
                            is_animated
                            thumbnail
                            thumbnails { url }
                        }
                        info { has_next_page page total_pages total_items }
                    }
                }
            }`
        };

        const query = queries[operationName];
        if (!query) throw new Error("Unknown op: " + operationName);

        const payload = {
            operationName: operationName,
            query: query,
            variables: variables
        };

        const url = this.source.apiUrl + "?operationName=" + encodeURIComponent(operationName);
        const res = await new Client().post(url, this.getHeaders(), payload);
        const text = res.body || "";

        if (!text || text.trim().startsWith("<")) {
            throw new Error("Bad response: " + text.substring(0, 120));
        }

        const data = JSON.parse(text);
        if (data.errors) {
            throw new Error("GQL: " + JSON.stringify(data.errors).substring(0, 350));
        }
        return data;
    }

    async getPopular(page) {
        const vars = { input: { display: "rating_all_time", page: page || 1, filters: [] } };
        const data = await this.graphql("AlbumListWithPeek", vars);
        return this.parse(data);
    }

    async getLatestUpdates(page) {
        const vars = { input: { display: "date_newest", page: page || 1, filters: [] } };
        const data = await this.graphql("AlbumListWithPeek", vars);
        return this.parse(data);
    }

    async search(query, page, filters) {
        const vars = { input: { display: "search_score", search_query: query, page: page || 1, filters: [] } };
        const data = await this.graphql("AlbumListWithPeek", vars);
        return this.parse(data);
    }

    parse(data) {
        const ld = data?.data?.album?.list || {};
        const items = ld.items || [];
        const list = items.map(a => ({
            name: a.title || "Untitled",
            link: a.url ? (a.url.startsWith("http") ? a.url : "https://members.luscious.net" + a.url) : "https://members.luscious.net/albums/" + a.id + "/",
            imageUrl: a.cover?.url || ""
        }));
        return { list, hasNextPage: !!ld.info?.has_next_page };
    }

    async getDetail(url) {
        const id = this.extractId(url);
        if (!id) return { name: "Error - no ID", chapters: [] };
        const data = await this.graphql("AlbumGet", { id });
        const album = data?.data?.album?.get || {};
        return {
            name: album.title || "Unknown",
            description: album.description || "",
            status: 5,
            chapters: [{ name: "Album (" + (album.number_of_pictures || "?") + " pics)", url: url, dateUpload: Date.now().toString() }]
        };
    }

    extractId(url) {
        const m = url.match(/_(\d+)/) || url.match(/\/(\d+)\/?$/);
        return m ? m[1] : null;
    }

    async getPageList(url) {
        const id = this.extractId(url);
        if (!id) return [];

        const allPages = [];
        let page = 1;
        let hasNext = true;
        const maxPages = 40;

        while (hasNext && page <= maxPages) {
            const vars = {
                input: {
                    filters: [{ name: "album_id", value: id }],
                    display: "date_newest",
                    page: page
                }
            };

            const data = await this.graphql("AlbumListOwnPictures", vars);
            const list = data?.data?.picture?.list || {};
            const items = list.items || [];

            for (const p of items) {
                // gallery-dl gif=True logic: prefer url_to_original (GIF) over url_to_video (MP4)
                let img = p.url_to_original || p.url_to_video || p.thumbnail;
                if (!img && p.thumbnails && p.thumbnails.length > 0) {
                    img = p.thumbnails[0].url;
                }
                if (img) allPages.push(img);
            }

            hasNext = !!list.info?.has_next_page;
            page++;
        }

        return allPages;
    }
}
