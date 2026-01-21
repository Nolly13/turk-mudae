// AniList API entegrasyonu (GraphQL)
// https://anilist.gitbook.io/anilist-apiv2-docs/

const ANILIST_API_URL = "https://graphql.anilist.co";
const RATE_LIMIT_DELAY = 700; // 0.7 saniye (AniList rate limit: 90 req/min)

interface AniListCharacter {
    id: number;
    name: {
        full: string;
        native: string;
    };
    image: {
        large: string;
        medium: string;
    };
    favourites: number;
    description: string;
    media: {
        nodes: Array<{
            title: {
                romaji: string;
                english: string;
            };
        }>;
    };
}

// Rate limiting için bekleme
function delay(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * AniList'te karakter ara (isimle)
 */
export async function searchCharacterAniList(query: string): Promise<AniListCharacter[]> {
    const graphqlQuery = `
        query ($search: String) {
            Page(page: 1, perPage: 5) {
                characters(search: $search) {
                    id
                    name {
                        full
                        native
                    }
                    image {
                        large
                        medium
                    }
                    favourites
                    description
                    media(page: 1, perPage: 1) {
                        nodes {
                            title {
                                romaji
                                english
                            }
                        }
                    }
                }
            }
        }
    `;

    try {
        await delay(RATE_LIMIT_DELAY);
        const response = await fetch(ANILIST_API_URL, {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                "Accept": "application/json",
            },
            body: JSON.stringify({
                query: graphqlQuery,
                variables: { search: query }
            })
        });

        const data = await response.json();
        return data.data?.Page?.characters || [];
    } catch (error) {
        console.error("AniList API hatası:", error);
        return [];
    }
}

/**
 * AniList'ten top karakterleri getir (favori sıralamasına göre)
 */
export async function getTopCharactersAniList(page: number = 1, perPage: number = 25): Promise<AniListCharacter[]> {
    const graphqlQuery = `
        query ($page: Int, $perPage: Int) {
            Page(page: $page, perPage: $perPage) {
                characters(sort: FAVOURITES_DESC) {
                    id
                    name {
                        full
                        native
                    }
                    image {
                        large
                        medium
                    }
                    favourites
                    description
                    media(page: 1, perPage: 1) {
                        nodes {
                            title {
                                romaji
                                english
                            }
                        }
                    }
                }
            }
        }
    `;

    try {
        await delay(RATE_LIMIT_DELAY);
        const response = await fetch(ANILIST_API_URL, {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                "Accept": "application/json",
            },
            body: JSON.stringify({
                query: graphqlQuery,
                variables: { page, perPage }
            })
        });

        const data = await response.json();
        return data.data?.Page?.characters || [];
    } catch (error) {
        console.error("AniList API hatası:", error);
        return [];
    }
}

/**
 * Karakter ID'si ile detaylı bilgi getir
 */
export async function getCharacterByIdAniList(id: number): Promise<AniListCharacter | null> {
    const graphqlQuery = `
        query ($id: Int) {
            Character(id: $id) {
                id
                name {
                    full
                    native
                }
                image {
                    large
                    medium
                }
                favourites
                description
                media(page: 1, perPage: 1) {
                    nodes {
                        title {
                            romaji
                            english
                        }
                    }
                }
            }
        }
    `;

    try {
        await delay(RATE_LIMIT_DELAY);
        const response = await fetch(ANILIST_API_URL, {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                "Accept": "application/json",
            },
            body: JSON.stringify({
                query: graphqlQuery,
                variables: { id }
            })
        });

        const data = await response.json();
        return data.data?.Character || null;
    } catch (error) {
        console.error("AniList API hatası:", error);
        return null;
    }
}
