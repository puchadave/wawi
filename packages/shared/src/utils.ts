import { WaWiProduct } from "./types/product";

export function getProductDisplayData(product: WaWiProduct) {
    // Manual data overrides AI data, which overrides Matterhorn data
    const title = product.manualData?.title || product.aiData?.title || product.matterhornData.name;
    const description = product.manualData?.description || product.aiData?.description || product.matterhornData.descriptionHtml;
    const metaTitle = product.manualData?.metaTitle || product.aiData?.metaTitle;
    const metaDescription = product.manualData?.metaDescription || product.aiData?.metaDescription;

    return { title, description, metaTitle, metaDescription };
}
