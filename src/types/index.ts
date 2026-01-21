// TypeScript type definitions for Türk Mudae Bot

export type CharacterCategory = 'Anime' | 'Film' | 'Dizi' | 'Meme' | 'Webtoon' | 'Manhwa';

export interface Character {
    id: number;
    name: string;
    series: string;
    category: CharacterCategory;
    image_url: string;
    rank: number; // #1, #2, #3... (1 = en değerli)
    created_at: string;
}

export interface User {
    id: number;
    discord_id: string;
    shorecoins: number;
    daily_claimed_at: string | null;
    created_at: string;
}

export interface UserCharacter {
    id: number;
    user_id: number;
    character_id: number;
    level: number;
    acquired_at: string;
}

export interface Auction {
    id: number;
    seller_id: number;
    user_character_id: number;
    starting_price: number;
    current_bid: number;
    highest_bidder_id: number | null;
    ends_at: string;
    status: 'active' | 'completed' | 'cancelled';
    created_at: string;
}

export interface AuctionBid {
    id: number;
    auction_id: number;
    bidder_id: number;
    amount: number;
    created_at: string;
}

export interface Trade {
    id: number;
    from_user_id: number;
    to_user_id: number;
    offer_character_id: number | null;
    offer_coins: number;
    request_character_id: number | null;
    request_coins: number;
    status: 'pending' | 'accepted' | 'rejected' | 'cancelled';
    created_at: string;
}

export interface SpawnedCharacter {
    character: Character;
    claimed: boolean;
    claimed_by: string | null;
    expires_at: number;
    messageId: string | null;
}
