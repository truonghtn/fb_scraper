
export type PostType = "ad";
export const POST_TYPE = {
    Ad: <PostType>'ad'
};
export interface IPost {
    pid: string;
    img_urls: string[];
    type?: PostType;
    page_id: string;
    content: string;
}

export interface ICursorAds {
    timeline_cursor: string;
    timeline_section_cursor: object;
    has_next_page: boolean;
}