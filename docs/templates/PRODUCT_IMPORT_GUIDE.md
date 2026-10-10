# How to fill the product list

Use this sheet to add all your products to the new website and admin panel at once, or to update prices for many products together.

**Files:**

- `product-import-template.xlsx` (recommended). Open it in Excel or Google Sheets. It has drop-down lists and an **Instructions** tab.
- `product-import-template.csv`, for when you prefer a plain CSV file.

## Steps

1. Open the template. The first row holds the column names. **Do not change or delete the first row.**
2. Delete the 3 example rows (7cm Electric Sparkler, Flower Pot Big, Lunik Rocket) and type your products, **one product per row**.
3. Save the file. If you use the CSV, choose _File → Save As → CSV UTF-8 (Comma delimited)_ in Excel.
4. Send the file to us, or upload it in the admin panel under **Products → Import**.
5. The admin panel first **checks** the file and lists any problems with the row number, for example _"Row 14, mrp: Must be a number"_. Nothing is saved until every row is correct.

## What to put in each column

Columns marked **Required** must be filled for every product. Everything else can be left empty.

| Column              | Required?    | What to enter                                                                                          | Example                               |
| ------------------- | ------------ | ------------------------------------------------------------------------------------------------------ | ------------------------------------- |
| `sku`               | **Required** | Your own unique code for the product. Letters, numbers and `-` only. No two products can share a code. | `SP-7CM`                              |
| `name`              | **Required** | Product name, as customers should see it.                                                              | `7cm Electric Sparkler`               |
| `category`          | **Required** | Category name, spelled the same way every time.                                                        | `Sparklers`                           |
| `sub_category`      | Optional     | A smaller group inside the category.                                                                   | `10cm`                                |
| `unit`              | **Required** | How it is sold: `box`, `pkt` or `piece`.                                                               | `box`                                 |
| `contents_per_unit` | Optional     | Pieces inside one unit.                                                                                | `10`                                  |
| `mrp`               | **Required** | MRP in rupees. No ₹ sign needed.                                                                       | `199` or `199.50`                     |
| `discount_percent`  | Optional     | Your discount %. The net price is worked out automatically.                                            | `80` or `82.5`                        |
| `hsn`               | Optional     | Leave empty. We use 3604 (fireworks) unless your accountant says otherwise.                            |                                       |
| `gst_rate`          | Optional     | Leave empty to use the store's GST rate. Fill only if this product has a different rate.               | `18`                                  |
| `opening_stock`     | Optional     | How many units you have now (only used the first time a product is added).                             | `500`                                 |
| `low_stock_alert`   | Optional     | We warn you when stock falls to this number.                                                           | `50`                                  |
| `green_cracker`     | Optional     | `yes` or `no`.                                                                                         | `yes`                                 |
| `sound_level`       | Optional     | `none`, `low`, `medium`, `high` or `very_high`.                                                        | `low`                                 |
| `min_age`           | Optional     | Minimum age to use the product.                                                                        | `12`                                  |
| `safety_warning`    | Optional     | A short safety note shown with the product.                                                            | `Light on flat ground and step back.` |
| `description`       | Optional     | Longer description for the website.                                                                    |                                       |
| `tags`              | Optional     | Keywords separated by `;`                                                                              | `kids;night`                          |
| `video_url`         | Optional     | A YouTube or video link starting with `https://`.                                                      |                                       |
| `active`            | Optional     | `yes` = shown on the website (default). `no` = hidden.                                                 | `yes`                                 |
| `featured`          | Optional     | `yes` = shown in the featured section.                                                                 | `no`                                  |
| `sort_order`        | Optional     | Order inside the category. Smaller numbers come first.                                                 | `1`                                   |

## Good to know

- **Prices:** write the **MRP** and the **discount %**, as in your printed price list. For example, MRP 199 with 82.5% discount gives a net price of ₹35. The system works out the net price and the GST split for invoices.
- **Updating prices later:** send the same file again with new MRP or discount values. Products are matched by `sku`. Existing products are updated, and new SKUs are added.
- **Stock:** `opening_stock` only counts for **new** products. To change stock later, use **Inventory → Stock in** in the admin panel, so every change is recorded.
- **Gift boxes / combo packs** are not added through this sheet. Once the single products are in, we build gift boxes in the admin panel by choosing their contents.
- **Categories:** spell each category the same way on every row (`Flower Pots`, not `Flowerpots` on some rows). The **Categories** tab in the Excel file lists the ones already set up. New category names can be created during the upload.
- **Photos** are added in the admin panel, not in this sheet.

## Common mistakes

| Problem shown                       | What to do                                                               |
| ----------------------------------- | ------------------------------------------------------------------------ |
| "Duplicate SKU (also on row 5)"     | Two rows have the same `sku`. Give each product its own code.            |
| "mrp: Must be a number"             | Remove words like "Rs" and keep at most two decimals.                    |
| "unit: Use one of: box, pkt, piece" | Type exactly `box`, `pkt` or `piece`.                                    |
| "Category … not found"              | Check the spelling, or ask us to allow new categories during the upload. |
| Strange characters (â‚¹) in names   | Save as **CSV UTF-8**, or send the `.xlsx` file instead.                 |
